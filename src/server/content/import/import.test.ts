/**
 * The importer, against the repository's real content.
 *
 * #42's acceptance is precise: two clean rehearsals into disposable databases
 * produce identical reconciliation reports, and re-running identical input is a
 * no-op. Both are asserted here directly rather than approximated, because they
 * are the properties that make a one-way migration safe to attempt.
 *
 * The sources are the real ones. A fixture would let the importer pass while
 * being wrong about the files it will actually read.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../database/connection";
import { runMigrations } from "../../database/migrator";
import { ContentRepository } from "../../database/contentRepository";
import { readLegacySources } from "./sources";
import { readLegacyConfig } from "./legacyConfig";
import { planImport, planIsWritable } from "./plan";
import { runImport, serializeReport } from "./run";
import { failingMediaResolver, stubMediaResolver } from "./stubResolver";

const temporaryDirectories: string[] = [];

function disposableDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "import-run-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

async function plan(resolver = stubMediaResolver()) {
  return planImport(readLegacySources(), readLegacyConfig(), resolver);
}

describe("planning today's content", () => {
  test("produces no blocking findings", async () => {
    const planned = await plan();

    // If this fails the migration cannot proceed without an edit, which would
    // make it not a migration. The finding list is included in the failure so
    // the reason is visible without re-running by hand.
    expect(planned.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(planIsWritable(planned)).toBe(true);
  });

  test("plans every entity the site has", async () => {
    const planned = await plan();
    const byType = planned.entities.reduce<Record<string, number>>(
      (totals, entity) => ({
        ...totals,
        [entity.type]: (totals[entity.type] ?? 0) + 1,
      }),
      {}
    );

    expect(byType).toEqual({
      home: 1,
      about: 1,
      branding: 1,
      project: 2,
      blog_post: 1,
    });
  });

  test("keeps the slugs the site already serves", async () => {
    const planned = await plan();
    const slugs = planned.entities
      .filter((entity) => entity.slug !== null)
      .map((entity) => entity.slug)
      .sort();

    // These are live URLs. A changed slug is a broken link.
    expect(slugs).toEqual([
      "minimal-portfolio",
      "questurian",
      "who-is-alan-malpartida-software-engineer-and-founder",
    ]);
  });

  test("one physical asset serves both of og.png's roles", async () => {
    const planned = await plan();
    const og = planned.media.filter(
      (entry) => entry.reference === "/public/og.png"
    );

    // #36 calls this out specifically. Two uploads of identical bytes would be
    // waste; two Media records would make deletion ambiguous.
    expect(og.map((entry) => entry.role).sort()).toEqual([
      "branding.defaultSharingImage",
      "project.minimal-portfolio.card",
    ]);
    expect(new Set(og.map((entry) => entry.mediaAssetId)).size).toBe(1);
  });

  test("the Questurian card is planned as a Cloudinary asset", async () => {
    const planned = await plan();
    const card = planned.media.find(
      (entry) => entry.role === "project.questurian.card"
    );

    expect(card?.kind).toBe("cloudinary");
  });

  test("the blog view count is attached to the post's immutable ID", async () => {
    const planned = await plan();
    const post = planned.entities.find((entity) => entity.type === "blog_post");

    expect(planned.views).toEqual([
      {
        slug: "who-is-alan-malpartida-software-engineer-and-founder",
        contentId: post!.id,
        count: 4,
      },
    ]);
  });

  test("reports the values it chose rather than copied", async () => {
    const planned = await plan();
    const derived = planned.entities.flatMap((entity) => entity.derived);

    // Alt text for the two Project cards is invented: the legacy markup renders
    // them with an empty alt, and #32 requires alt text to publish. Surfacing
    // it means the Owner can see and change exactly what was authored for them.
    expect(derived).toContain("project.questurian.card.alt");
    expect(derived).toContain("branding.logo.alt");
    expect(derived).toContain(
      "blog.who-is-alan-malpartida-software-engineer-and-founder.leadingH1"
    );
  });

  test("refuses to plan content pointing at images it could not resolve", async () => {
    const planned = await plan(failingMediaResolver());

    expect(planIsWritable(planned)).toBe(false);
    expect(planned.findings.map((finding) => finding.code)).toContain(
      "media_unresolved"
    );
  });
});

describe("two rehearsals produce identical reports", () => {
  test("byte for byte", async () => {
    // #42's acceptance criterion, asserted literally.
    const first = runImport(disposableDatabase(), await plan(), {
      mode: "rehearsal",
      dryRun: false,
      now: new Date("2026-07-31T00:00:00.000Z"),
    });

    const second = runImport(disposableDatabase(), await plan(), {
      mode: "rehearsal",
      dryRun: false,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });

    // Different databases, different clocks, same report. The serialisation
    // deliberately excludes the run id and timestamps, which are the only
    // things that legitimately differ.
    expect(serializeReport(first)).toBe(serializeReport(second));
    expect(first.committed).toBe(true);
    expect(second.committed).toBe(true);
  });

  test("entity IDs are stable across runs", async () => {
    const first = await plan();
    const second = await plan();

    expect(first.entities.map((entity) => entity.id)).toEqual(
      second.entities.map((entity) => entity.id)
    );
  });

  test("a dry run reports exactly what a commit would do", async () => {
    const planned = await plan();
    const database = disposableDatabase();

    const dry = runImport(database, planned, {
      mode: "rehearsal",
      dryRun: true,
    });
    const wet = runImport(database, planned, {
      mode: "rehearsal",
      dryRun: false,
    });

    // A dry run that is a different code path is a dry run with its own bugs.
    expect(dry.counts).toEqual(wet.counts);
    expect(dry.committed).toBe(false);
    expect(wet.committed).toBe(true);
  });
});

describe("re-running identical input", () => {
  test("is a no-op", async () => {
    const database = disposableDatabase();

    const first = runImport(database, await plan(), {
      mode: "rehearsal",
      dryRun: false,
    });
    const second = runImport(database, await plan(), {
      mode: "rehearsal",
      dryRun: false,
    });

    expect(first.counts.entitiesCreated).toBe(6);
    expect(second.counts.entitiesCreated).toBe(0);
    expect(second.counts.entitiesReplaced).toBe(0);
    expect(second.counts.entitiesUnchanged).toBe(6);
  });

  test("does not duplicate anything", async () => {
    const database = disposableDatabase();
    const repository = new ContentRepository(database);

    for (let run = 0; run < 3; run += 1) {
      runImport(database, await plan(), { mode: "rehearsal", dryRun: false });
    }

    expect(repository.countByType()).toEqual({
      home: 1,
      about: 1,
      branding: 1,
      project: 2,
      blog_post: 1,
    });
  });

  test("view counts are not double-counted", async () => {
    const database = disposableDatabase();

    for (let run = 0; run < 3; run += 1) {
      runImport(database, await plan(), { mode: "rehearsal", dryRun: false });
    }

    const total = database
      .query("SELECT SUM(views) AS total FROM content_view_counts")
      .get() as { total: number };

    // The count is the site's real total, not three times it.
    expect(total.total).toBe(4);
  });
});

describe("refusing to overwrite the Owner", () => {
  test("an edited entity stops the whole run", async () => {
    const database = disposableDatabase();
    const repository = new ContentRepository(database);

    runImport(database, await plan(), { mode: "rehearsal", dryRun: false });

    const project = repository.findBySlug("project", "questurian")!;
    repository.update(
      project.id,
      { data: { title: "Edited by hand" } },
      "owner"
    );

    const second = runImport(database, await plan(), {
      mode: "rehearsal",
      dryRun: false,
    });

    expect(second.committed).toBe(false);
    expect(second.findings.map((f) => f.code)).toContain(
      "owner_edited_refuses_import"
    );
  });

  test("and writes nothing at all, not even the untouched entities", async () => {
    const database = disposableDatabase();
    const repository = new ContentRepository(database);

    runImport(database, await plan(), { mode: "rehearsal", dryRun: false });

    const project = repository.findBySlug("project", "questurian")!;
    repository.update(project.id, { data: { title: "Edited" } }, "owner");

    const runsBefore = database
      .query("SELECT COUNT(*) AS n FROM import_runs")
      .get() as { n: number };

    runImport(database, await plan(), { mode: "rehearsal", dryRun: false });

    const runsAfter = database
      .query("SELECT COUNT(*) AS n FROM import_runs")
      .get() as { n: number };

    // No partial import: a refusal leaves the database exactly as it was.
    expect(runsAfter.n).toBe(runsBefore.n);
    expect(repository.findById(project.id)?.data).toEqual({ title: "Edited" });
  });
});

describe("the production gate", () => {
  test("refuses without an expected fingerprint", async () => {
    const report = runImport(disposableDatabase(), await plan(), {
      mode: "production",
      dryRun: false,
    });

    expect(report.committed).toBe(false);
    expect(report.findings.map((f) => f.code)).toContain(
      "production_requires_expected_fingerprint"
    );
  });

  test("refuses when the source moved since review", async () => {
    const report = runImport(disposableDatabase(), await plan(), {
      mode: "production",
      dryRun: false,
      expectedFingerprint: "0".repeat(64),
    });

    expect(report.committed).toBe(false);
    expect(report.findings.map((f) => f.code)).toContain(
      "source_fingerprint_mismatch"
    );
  });

  test("commits when the fingerprint matches what was reviewed", async () => {
    const planned = await plan();

    const report = runImport(disposableDatabase(), planned, {
      mode: "production",
      dryRun: false,
      expectedFingerprint: planned.fingerprint,
    });

    expect(report.committed).toBe(true);
    expect(report.mode).toBe("production");
  });

  test("a rehearsal does not need one", async () => {
    const report = runImport(disposableDatabase(), await plan(), {
      mode: "rehearsal",
      dryRun: false,
    });

    expect(report.committed).toBe(true);
  });
});

describe("the ledger", () => {
  test("records the run and every entity in it", async () => {
    const database = disposableDatabase();
    const report = runImport(database, await plan(), {
      mode: "rehearsal",
      dryRun: false,
    });

    const run = database
      .query("SELECT * FROM import_runs WHERE id = ?")
      .get(report.runId!) as Record<string, unknown>;

    expect(run.importer_version).toBe(1);
    expect(run.source_fingerprint).toBe(report.sourceFingerprint);
    expect(run.entities_created).toBe(6);
    expect(run.view_total).toBe(4);

    const entities = database
      .query("SELECT * FROM import_entities WHERE run_id = ?")
      .all(report.runId!) as Array<{ source_key: string; source_hash: string }>;

    expect(entities).toHaveLength(6);
    // Every row carries where it came from and what that source said at the
    // time, so "has this file changed since?" is answerable later.
    for (const entity of entities) {
      expect(entity.source_key).not.toBe("");
      expect(entity.source_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("a dry run writes no ledger row", async () => {
    const database = disposableDatabase();
    runImport(database, await plan(), { mode: "rehearsal", dryRun: true });

    expect(
      (
        database.query("SELECT COUNT(*) AS n FROM import_runs").get() as {
          n: number;
        }
      ).n
    ).toBe(0);
  });
});

describe("source fingerprints", () => {
  test("cover every file the import reads", async () => {
    const sources = readLegacySources();

    expect(sources.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(sources.config.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sources.projects).toHaveLength(2);
    expect(sources.blogPosts).toHaveLength(1);
    expect(sources.views.source).not.toBeNull();
  });

  test("are stable across reads", () => {
    expect(readLegacySources().fingerprint).toBe(
      readLegacySources().fingerprint
    );
  });
});
