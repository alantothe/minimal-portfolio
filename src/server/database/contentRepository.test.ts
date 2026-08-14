/**
 * Content storage, with the constraints the schema is supposed to enforce.
 *
 * These tests go through real SQLite rather than a stub, because the guarantees
 * being checked are the *table's* — the singleton uniqueness index, the
 * slug/type check, the deletion trigger. Asserting them against a fake would
 * prove only that the fake agrees with itself, and the whole reason to put a
 * rule in the schema is that it holds regardless of which code path writes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./connection";
import { runMigrations } from "./migrator";
import {
  ContentRepository,
  UnsupportedSchemaVersionError,
} from "./contentRepository";
import { SINGLETON_IDS, importedContentId } from "../content/identity";

const temporaryDirectories: string[] = [];

function migratedDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "content-repo-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

function repository(): { repo: ContentRepository; database: Database } {
  const database = migratedDatabase();
  return { repo: new ContentRepository(database), database };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

const QUESTURIAN_ID = importedContentId("project", "questurian");

function project(
  repo: ContentRepository,
  slug: string,
  order: number,
  now?: Date
) {
  return repo.create(
    {
      id: importedContentId("project", slug),
      type: "project",
      slug,
      data: { title: slug },
      displayOrder: order,
      origin: "import",
    },
    now
  );
}

describe("writing content", () => {
  test("stores and reads back a project", () => {
    const { repo } = repository();
    const created = project(repo, "questurian", 1);

    expect(created.id).toBe(QUESTURIAN_ID);
    expect(repo.findBySlug("project", "questurian")?.id).toBe(QUESTURIAN_ID);
    expect(repo.findById(QUESTURIAN_ID)?.data).toEqual({ title: "questurian" });
  });

  test("stamps every row with the current schema version", () => {
    const { repo } = repository();
    expect(project(repo, "questurian", 1).schemaVersion).toBe(1);
  });

  test("refuses a second row for a singleton", () => {
    const { repo } = repository();
    repo.create({
      id: SINGLETON_IDS.home,
      type: "home",
      data: {},
      origin: "import",
    });

    // There is exactly one Home. Enforced by the table, not by the caller.
    expect(() =>
      repo.create({ id: "other", type: "home", data: {}, origin: "import" })
    ).toThrow();
  });

  test("refuses two projects with the same slug", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);

    expect(() =>
      repo.create({
        id: "different-id",
        type: "project",
        slug: "questurian",
        data: {},
        origin: "import",
      })
    ).toThrow();
  });

  test("permits a Project and a Blog post to share a slug", () => {
    // #32 allows this: slugs are unique inside a collection, and the two live
    // at different route prefixes.
    const { repo } = repository();
    project(repo, "questurian", 1);

    expect(() =>
      repo.create({
        id: importedContentId("blog_post", "questurian"),
        type: "blog_post",
        slug: "questurian",
        data: {},
        origin: "import",
      })
    ).not.toThrow();
  });

  test("refuses a singleton with a slug, and a collection item without one", () => {
    const { repo } = repository();

    expect(() =>
      repo.create({
        id: SINGLETON_IDS.about,
        type: "about",
        slug: "about-me",
        data: {},
        origin: "import",
      })
    ).toThrow();

    expect(() =>
      repo.create({
        id: "no-slug",
        type: "project",
        slug: null,
        data: {},
        origin: "import",
      })
    ).toThrow();
  });
});

describe("identity rules", () => {
  test("a singleton cannot be deleted", () => {
    const { repo, database } = repository();
    repo.create({
      id: SINGLETON_IDS.home,
      type: "home",
      data: {},
      origin: "import",
    });

    expect(() =>
      database
        .query("DELETE FROM content_items WHERE id = ?")
        .run(SINGLETON_IDS.home)
    ).toThrow();
  });

  test("a collection item can be", () => {
    const { repo, database } = repository();
    project(repo, "questurian", 1);

    expect(() =>
      database
        .query("DELETE FROM content_items WHERE id = ?")
        .run(QUESTURIAN_ID)
    ).not.toThrow();
  });

  test("an ID cannot be changed", () => {
    const { repo, database } = repository();
    project(repo, "questurian", 1);

    // IDs are never reused, and published revisions point at them.
    expect(() =>
      database
        .query("UPDATE content_items SET id = ? WHERE id = ?")
        .run("new-id", QUESTURIAN_ID)
    ).toThrow();
  });

  test("a type cannot be changed", () => {
    const { repo, database } = repository();
    project(repo, "questurian", 1);

    expect(() =>
      database
        .query("UPDATE content_items SET type = ? WHERE id = ?")
        .run("blog_post", QUESTURIAN_ID)
    ).toThrow();
  });
});

describe("provenance", () => {
  test("an untouched imported row may be replaced by a re-import", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);

    expect(repo.isReplaceableByImport(QUESTURIAN_ID)).toBe(true);
  });

  test("a missing row is replaceable, because there is nothing to lose", () => {
    const { repo } = repository();
    expect(repo.isReplaceableByImport("never-created")).toBe(true);
  });

  test("an Owner edit makes the row off-limits to the importer", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);

    repo.update(QUESTURIAN_ID, { data: { title: "Edited" } }, "owner");

    // #36: after any Owner edit, changed input is refused rather than
    // overwriting work the Owner did.
    expect(repo.isReplaceableByImport(QUESTURIAN_ID)).toBe(false);
    expect(repo.findById(QUESTURIAN_ID)?.ownerEditedAt).not.toBeNull();
  });

  test("an importer update does not mark the row as owner-edited", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);

    repo.update(QUESTURIAN_ID, { data: { title: "Re-imported" } }, "import");

    expect(repo.findById(QUESTURIAN_ID)?.ownerEditedAt).toBeNull();
    expect(repo.isReplaceableByImport(QUESTURIAN_ID)).toBe(true);
  });

  test("an owner edit is remembered even after a later import touch", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);

    repo.update(QUESTURIAN_ID, { data: { title: "Edited" } }, "owner");
    repo.update(QUESTURIAN_ID, { data: { title: "Import" } }, "import");

    // The flag is sticky. Clearing it would let an import silently reclaim a
    // row the Owner had already made theirs.
    expect(repo.isReplaceableByImport(QUESTURIAN_ID)).toBe(false);
  });

  test("origin is fixed at creation and not a parameter of update", () => {
    const { repo } = repository();
    repo.create({
      id: "owner-made",
      type: "project",
      slug: "owner-made",
      data: {},
      origin: "owner",
    });

    repo.update("owner-made", { data: { a: 1 } }, "import");

    expect(repo.findById("owner-made")?.origin).toBe("owner");
    // Owner-created content is never replaceable by an import.
    expect(repo.isReplaceableByImport("owner-made")).toBe(false);
  });

  test("updating a row that does not exist reports it rather than creating one", () => {
    const { repo } = repository();
    expect(repo.update("missing", { data: {} }, "owner")).toBeNull();
  });
});

describe("conditional autosave", () => {
  test("updates the version the Owner read", () => {
    const { repo } = repository();
    const created = project(
      repo,
      "questurian",
      1,
      new Date("2026-08-14T19:59:00.000Z")
    );

    const outcome = repo.updateIfCurrent(
      created.id,
      { data: { title: "Fresh edit" } },
      "owner",
      created.updatedAt,
      new Date("2026-08-14T20:00:00.000Z")
    );

    expect(outcome.status).toBe("updated");
    if (outcome.status === "updated") {
      expect(outcome.item.data).toEqual({ title: "Fresh edit" });
      expect(outcome.item.updatedAt).toBe("2026-08-14T20:00:00.000Z");
    }
  });

  test("refuses a stale autosave instead of overwriting newer content", () => {
    const { repo } = repository();
    const created = project(
      repo,
      "questurian",
      1,
      new Date("2026-08-14T19:59:00.000Z")
    );
    repo.update(
      created.id,
      { data: { title: "Newer tab" } },
      "owner",
      new Date("2026-08-14T20:00:00.000Z")
    );

    const outcome = repo.updateIfCurrent(
      created.id,
      { data: { title: "Stale tab" } },
      "owner",
      created.updatedAt,
      new Date("2026-08-14T20:01:00.000Z")
    );

    expect(outcome).toEqual({
      status: "conflict",
      currentUpdatedAt: "2026-08-14T20:00:00.000Z",
    });
    expect(repo.findById(created.id)?.data).toEqual({ title: "Newer tab" });
  });

  test("reports a missing Content item without creating it", () => {
    const { repo } = repository();

    expect(
      repo.updateIfCurrent("missing", { data: {} }, "owner", "old")
    ).toEqual({ status: "not-found" });
  });

  test("advances the version when two writes share a clock millisecond", () => {
    const { repo } = repository();
    const now = new Date("2026-08-14T20:00:00.000Z");
    const created = repo.create(
      {
        id: SINGLETON_IDS.home,
        type: "home",
        data: {},
        origin: "import",
      },
      now
    );

    const outcome = repo.updateIfCurrent(
      created.id,
      { data: { displayName: "Ada" } },
      "owner",
      created.updatedAt,
      now
    );

    expect(outcome.status).toBe("updated");
    if (outcome.status === "updated") {
      expect(outcome.item.updatedAt).toBe("2026-08-14T20:00:00.001Z");
      expect(outcome.item.updatedAt).not.toBe(created.updatedAt);
    }
  });
});

describe("ordering", () => {
  test("projects come back in the Owner's order, not insertion order", () => {
    const { repo } = repository();
    project(repo, "minimal-portfolio", 6);
    project(repo, "questurian", 1);

    expect(repo.list("project").map((item) => item.slug)).toEqual([
      "questurian",
      "minimal-portfolio",
    ]);
  });

  test("blog posts come back newest first", () => {
    const { repo } = repository();
    for (const [slug, date] of [
      ["older", "2025-01-01"],
      ["newer", "2026-02-11"],
    ] as const) {
      repo.create({
        id: importedContentId("blog_post", slug),
        type: "blog_post",
        slug,
        data: {},
        publishedAt: date,
        origin: "import",
      });
    }

    expect(repo.list("blog_post").map((item) => item.slug)).toEqual([
      "newer",
      "older",
    ]);
  });

  test("listing a singleton returns it, or nothing", () => {
    const { repo } = repository();
    expect(repo.list("home")).toEqual([]);

    repo.create({
      id: SINGLETON_IDS.home,
      type: "home",
      data: {},
      origin: "import",
    });

    expect(repo.list("home")).toHaveLength(1);
  });

  test("reports taken slugs for collision suggestions", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);
    project(repo, "minimal-portfolio", 6);

    expect(repo.takenSlugs("project")).toEqual(
      new Set(["questurian", "minimal-portfolio"])
    );
    expect(repo.takenSlugs("blog_post").size).toBe(0);
  });

  test("counts by type, for the reconciliation report", () => {
    const { repo } = repository();
    project(repo, "questurian", 1);
    project(repo, "minimal-portfolio", 6);

    expect(repo.countByType()).toEqual({ project: 2 });
  });
});

describe("schema versioning", () => {
  test("a row written by a newer release is refused rather than guessed at", () => {
    const { repo, database } = repository();
    project(repo, "questurian", 1);

    database
      .query("UPDATE content_items SET schema_version = 99 WHERE id = ?")
      .run(QUESTURIAN_ID);

    // Failing closed: rendering content this release cannot fully interpret
    // would publish something nobody wrote.
    expect(() => repo.findById(QUESTURIAN_ID)).toThrow(
      UnsupportedSchemaVersionError
    );
  });
});
