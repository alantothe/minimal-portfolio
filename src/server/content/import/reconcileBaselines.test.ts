import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ContentRepository } from "../../database/contentRepository";
import { PublicationRepository } from "../../database/publicationRepository";
import { migratedDatabase } from "../../published/fixtures";
import type { ProjectContent } from "../schema";
import type { ImportPlan } from "./plan";
import { reconcileImportedBaselinesFromPlan } from "./reconcileBaselines";

const directories: string[] = [];

afterEach(() => {
  while (directories.length) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("recovering a pre-publication import baseline", () => {
  test("uses accepted import provenance while preserving the Owner's private draft", () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    const content = new ContentRepository(database);
    const id = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const original: ProjectContent = {
      title: "Imported Project",
      summary: "The accepted source summary.",
      card: null,
      kicker: "Selected work",
      role: "Engineer",
      status: "Live",
      period: "2026",
      technologies: ["TypeScript"],
      liveUrl: null,
      repositoryUrl: null,
      accentColor: "#8aa0b2",
      bodyMarkdown: "## Context\n\nImported body.",
      seo: { title: null, description: null, sharingImage: null },
    };
    const imported = content.create({
      id,
      type: "project",
      slug: "accepted-route",
      displayOrder: 1,
      data: original,
      origin: "import",
    });
    const ownerDraft = content.update(
      id,
      {
        slug: "private-pending-route",
        data: { ...original, title: "Private draft title" },
      },
      "owner"
    )!;
    const at = "2026-08-14T12:00:00.000Z";
    database
      .query(
        `INSERT INTO import_runs (
           id, importer_version, source_fingerprint, mode,
           entities_created, entities_replaced, entities_unchanged,
           media_resolved, views_imported, view_total, started_at, completed_at
         ) VALUES (?, 1, 'fingerprint', 'production', 1, 0, 0, 0, 0, 0, ?, ?)`
      )
      .run("accepted-run", at, at);
    database
      .query(
        `INSERT INTO import_entities
           (run_id, content_id, source_key, source_hash, outcome)
         VALUES ('accepted-run', ?, 'project:accepted-route', 'source-v1', 'created')`
      )
      .run(id);
    const plan: ImportPlan = {
      fingerprint: "fingerprint",
      entities: [
        {
          id,
          type: "project",
          slug: imported.slug,
          data: original,
          displayOrder: imported.displayOrder,
          publishedAt: null,
          sourceKey: "project:accepted-route",
          sourceHash: "source-v1",
          derived: [],
        },
      ],
      media: [],
      views: [],
      findings: [],
    };

    expect(
      reconcileImportedBaselinesFromPlan(
        database,
        plan,
        new Date("2026-08-14T13:00:00.000Z")
      )
    ).toEqual({ status: "seeded", count: 1 });

    const revision = new PublicationRepository(database).currentRevision(id)!;
    expect(revision.snapshot.slug).toBe("accepted-route");
    expect((revision.snapshot.data as ProjectContent).title).toBe(
      "Imported Project"
    );
    expect(content.findById(id)).toMatchObject({
      slug: "private-pending-route",
      draftVersion: ownerDraft.draftVersion,
      data: { title: "Private draft title" },
    });
    expect(
      new PublicationRepository(database).routeOwner("/projects/accepted-route")
    ).toBe(id);
  });

  test("refuses a plan that does not match accepted provenance", () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    const content = new ContentRepository(database);
    const item = content.create({
      id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
      type: "project",
      slug: "private-project",
      displayOrder: 1,
      data: {},
      origin: "import",
    });
    const plan: ImportPlan = {
      fingerprint: "different",
      entities: [],
      media: [],
      views: [],
      findings: [],
    };

    expect(reconcileImportedBaselinesFromPlan(database, plan)).toEqual({
      status: "blocked",
      reason: "import_provenance_mismatch",
    });
    expect(
      new PublicationRepository(database).currentRevision(item.id)
    ).toBeNull();
  });
});
