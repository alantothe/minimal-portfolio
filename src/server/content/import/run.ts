/**
 * Committing a plan, or refusing to.
 *
 * Everything interesting was decided in `plan.ts`. What happens here is narrow
 * on purpose: check the preconditions, open one transaction, write, record the
 * ledger row, commit. #36 forbids a partial import, and the way to guarantee
 * that is for the write phase to contain no decisions that could fail halfway.
 *
 * Re-running identical input is a no-op. That is not achieved by comparing
 * timestamps — it is achieved because entity IDs are deterministic and the
 * stored source hash tells the run whether anything actually changed. An
 * unchanged source produces `unchanged` outcomes and touches no content row.
 *
 * The rule that stops an import from eating somebody's work lives in the
 * repository: a row is replaceable only while it is import-created and the
 * Owner has not edited it. This module asks, and refuses the whole run if the
 * answer is no for any entity.
 */

import { randomUUID, createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { ContentRepository } from "../../database/contentRepository";
import { PublicationRepository } from "../../database/publicationRepository";
import { planIsWritable, type ImportPlan, type PlannedEntity } from "./plan";
import type { Finding } from "../validation";

/**
 * Bumped when the importer's own logic changes in a way that would produce
 * different output from identical input. Recorded per run so a future
 * reconciliation can tell "the source changed" from "the rules changed".
 */
export const IMPORTER_VERSION = 1;

export type ImportMode = "rehearsal" | "production";

export type EntityOutcome = "created" | "replaced" | "unchanged";

export interface ReconciliationReport {
  runId: string | null;
  importerVersion: number;
  mode: ImportMode;
  sourceFingerprint: string;
  committed: boolean;
  counts: {
    entitiesCreated: number;
    entitiesReplaced: number;
    entitiesUnchanged: number;
    mediaResolved: number;
    viewsImported: number;
    viewTotal: number;
  };
  entities: Array<{
    contentId: string;
    type: string;
    slug: string | null;
    sourceKey: string;
    sourceHash: string;
    outcome: EntityOutcome;
    derived: string[];
  }>;
  media: Array<{
    role: string;
    reference: string;
    kind: string;
    mediaAssetId: string | null;
  }>;
  views: Array<{ slug: string; contentId: string; count: number }>;
  findings: Finding[];
}

export interface RunOptions {
  mode: ImportMode;
  /** Nothing is written when true. The report is otherwise identical. */
  dryRun: boolean;
  /**
   * Required for a production run. #42: the production command must be given
   * the fingerprint somebody reviewed, so an import cannot quietly pick up an
   * edit made after review.
   */
  expectedFingerprint?: string;
  now?: Date;
}

/**
 * Serialises with keys in a fixed order.
 *
 * The planned entity is a live object and the stored one came back through
 * `JSON.parse`. Plain `JSON.stringify` follows insertion order, so two
 * genuinely identical rows could hash differently purely because their keys
 * were built in a different sequence — which would report every re-run as a
 * replacement and make the no-op guarantee false.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(",")}}`;
}

/**
 * What the row would contain.
 *
 * Covers everything `content_items` stores about the content, so "unchanged"
 * means the row would be written identically — not merely that the source file
 * still has the same name.
 */
function rowHash(row: {
  data: unknown;
  slug: string | null;
  displayOrder: number | null;
  publishedAt: string | null;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        data: row.data,
        slug: row.slug,
        displayOrder: row.displayOrder,
        publishedAt: row.publishedAt,
      })
    )
    .digest("hex");
}

function blocked(field: string, code: string): Finding {
  return { field, code, severity: "error" };
}

/**
 * Applies a plan.
 *
 * Returns a report in every case, including refusal. A run that declined to
 * write is exactly as interesting as one that wrote, and giving the caller a
 * thrown error instead would lose the findings that explain why.
 */
export function runImport(
  database: Database,
  plan: ImportPlan,
  options: RunOptions
): ReconciliationReport {
  const now = options.now ?? new Date();
  const repository = new ContentRepository(database);
  const publication = new PublicationRepository(database);
  const findings: Finding[] = [...plan.findings];

  if (options.mode === "production") {
    if (!options.expectedFingerprint) {
      findings.push(blocked("run", "production_requires_expected_fingerprint"));
    } else if (options.expectedFingerprint !== plan.fingerprint) {
      // The source moved between review and run.
      findings.push(blocked("run", "source_fingerprint_mismatch"));
    }
  }

  // Decide every outcome before opening the transaction.
  const decisions: Array<{ entity: PlannedEntity; outcome: EntityOutcome }> =
    [];

  for (const entity of plan.entities) {
    const existing = repository.findIncludingArchivedById(entity.id);

    if (!existing) {
      decisions.push({ entity, outcome: "created" });
      continue;
    }

    if (!repository.isReplaceableByImport(entity.id)) {
      // #36: after any Owner edit, changed input is refused rather than
      // overwriting work somebody did by hand.
      findings.push(blocked(entity.id, "owner_edited_refuses_import"));
      continue;
    }

    decisions.push({
      entity,
      outcome: rowHash(existing) === rowHash(entity) ? "unchanged" : "replaced",
    });
  }

  const writable = planIsWritable({ ...plan, findings });
  const viewTotal = plan.views.reduce((total, view) => total + view.count, 0);

  const report: ReconciliationReport = {
    runId: null,
    importerVersion: IMPORTER_VERSION,
    mode: options.mode,
    sourceFingerprint: plan.fingerprint,
    committed: false,
    counts: {
      entitiesCreated: decisions.filter((d) => d.outcome === "created").length,
      entitiesReplaced: decisions.filter((d) => d.outcome === "replaced")
        .length,
      entitiesUnchanged: decisions.filter((d) => d.outcome === "unchanged")
        .length,
      mediaResolved: new Set(
        plan.media
          .filter((entry) => entry.mediaAssetId !== null)
          .map((entry) => entry.mediaAssetId)
      ).size,
      viewsImported: plan.views.length,
      viewTotal,
    },
    entities: decisions.map(({ entity, outcome }) => ({
      contentId: entity.id,
      type: entity.type,
      slug: entity.slug,
      sourceKey: entity.sourceKey,
      sourceHash: entity.sourceHash,
      outcome,
      derived: entity.derived,
    })),
    media: plan.media.map((entry) => ({
      role: entry.role,
      reference: entry.reference,
      kind: entry.kind,
      mediaAssetId: entry.mediaAssetId,
    })),
    views: plan.views,
    findings,
  };

  if (!writable || options.dryRun) {
    return report;
  }

  const runId = randomUUID();
  const at = now.toISOString();

  // One transaction for the whole graph. A failure anywhere rolls back to the
  // state before the run, which is what "no partial import" means in practice.
  database.transaction(() => {
    // The run row goes first: `import_entities.run_id` references it, and
    // foreign keys are enforced on this connection.
    database
      .query(
        `INSERT INTO import_runs (
           id, importer_version, source_fingerprint, mode,
           entities_created, entities_replaced, entities_unchanged,
           media_resolved, views_imported, view_total,
           started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        IMPORTER_VERSION,
        plan.fingerprint,
        options.mode,
        report.counts.entitiesCreated,
        report.counts.entitiesReplaced,
        report.counts.entitiesUnchanged,
        report.counts.mediaResolved,
        report.counts.viewsImported,
        report.counts.viewTotal,
        at,
        at
      );

    for (const { entity, outcome } of decisions) {
      let written = repository.findIncludingArchivedById(entity.id);
      if (outcome === "created") {
        written = repository.create(
          {
            id: entity.id,
            type: entity.type,
            slug: entity.slug,
            data: entity.data,
            displayOrder: entity.displayOrder,
            publishedAt: entity.publishedAt,
            origin: "import",
          },
          now
        );
      } else if (outcome === "replaced") {
        written = repository.update(
          entity.id,
          {
            slug: entity.slug,
            data: entity.data,
            displayOrder: entity.displayOrder,
            publishedAt: entity.publishedAt,
          },
          "import",
          now
        );
      }

      if ((outcome === "created" || outcome === "replaced") && written) {
        publication.seedMigrationRevision(written, now);
      }

      database
        .query(
          `INSERT INTO import_entities
             (run_id, content_id, source_key, source_hash, outcome)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(runId, entity.id, entity.sourceKey, entity.sourceHash, outcome);
    }

    for (const view of plan.views) {
      database
        .query(
          `INSERT INTO content_view_counts
             (content_id, views, imported_from_slug, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (content_id) DO UPDATE
             SET views = excluded.views,
                 imported_from_slug = excluded.imported_from_slug,
                 updated_at = excluded.updated_at`
        )
        .run(view.contentId, view.count, view.slug, at);
    }
  })();

  return { ...report, runId, committed: true };
}

/**
 * The report as a stable, diffable document.
 *
 * #42's acceptance is that two rehearsals produce *identical* reports, so the
 * serialisation must not contain a run id, a timestamp, or anything else that
 * varies between two runs of the same input.
 */
export function serializeReport(report: ReconciliationReport): string {
  const comparable = {
    importerVersion: report.importerVersion,
    sourceFingerprint: report.sourceFingerprint,
    counts: report.counts,
    entities: [...report.entities].sort((a, b) =>
      a.contentId < b.contentId ? -1 : 1
    ),
    media: [...report.media].sort((a, b) => (a.role < b.role ? -1 : 1)),
    views: [...report.views].sort((a, b) => (a.slug < b.slug ? -1 : 1)),
    findings: [...report.findings].sort((a, b) =>
      `${a.field}:${a.code}` < `${b.field}:${b.code}` ? -1 : 1
    ),
  };

  return `${JSON.stringify(comparable, null, 2)}\n`;
}
