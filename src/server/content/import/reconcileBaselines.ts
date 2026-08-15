/** Recover immutable import baselines without overwriting private Owner edits. */

import type { Database } from "bun:sqlite";
import {
  ContentRepository,
  type ContentItem,
} from "../../database/contentRepository";
import { PublicationRepository } from "../../database/publicationRepository";
import { hasBlockingError } from "../validation";
import type { ImportPlan, PlannedEntity } from "./plan";

export type BaselineReconciliation =
  | { status: "unchanged" }
  | { status: "seeded"; count: number }
  | { status: "blocked"; reason: string };

function baselineItem(
  current: ContentItem,
  entity: PlannedEntity
): ContentItem {
  return {
    ...current,
    type: entity.type,
    slug: entity.slug,
    data: entity.data,
    displayOrder: entity.displayOrder,
    publishedAt: entity.publishedAt,
  };
}

/**
 * Uses the exact source hash accepted by the original import. Only the
 * immutable Published revision comes from that plan; the current Content draft
 * row is left untouched apart from its publication pointers.
 */
export function reconcileImportedBaselinesFromPlan(
  database: Database,
  plan: ImportPlan,
  now = new Date()
): BaselineReconciliation {
  const publication = new PublicationRepository(database);
  const missing = publication.missingImportedBaselineIds();
  if (missing.length === 0) return { status: "unchanged" };
  if (hasBlockingError(plan.findings)) {
    return { status: "blocked", reason: "import_plan_invalid" };
  }

  const byId = new Map(plan.entities.map((entity) => [entity.id, entity]));
  const baselines: Array<{ current: ContentItem; entity: PlannedEntity }> = [];
  const content = new ContentRepository(database);
  for (const id of missing) {
    const current = content.findById(id);
    const entity = byId.get(id);
    const acceptedHash = publication.acceptedImportSourceHash(id);
    if (
      !current ||
      !entity ||
      current.type !== entity.type ||
      acceptedHash !== entity.sourceHash
    ) {
      return { status: "blocked", reason: "import_provenance_mismatch" };
    }
    baselines.push({ current, entity });
  }

  database.transaction(() => {
    for (const { current, entity } of baselines) {
      publication.seedMigrationRevision(baselineItem(current, entity), now);
    }
  })();

  return { status: "seeded", count: baselines.length };
}
