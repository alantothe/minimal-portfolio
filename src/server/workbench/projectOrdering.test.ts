import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ContentRepository } from "../database/contentRepository";
import { SystemStateRepository } from "../database/repository";
import { importedContentId } from "../content/identity";
import { buildSiteSnapshot } from "../published/snapshot";
import { migratedDatabase, seedPublishedSite } from "../published/fixtures";
import {
  moveProject,
  publishProjectOrder,
  type ProjectOrderingDependencies,
} from "./projectOrdering";

const directories: string[] = [];

function context() {
  const migrated = migratedDatabase();
  directories.push(migrated.directory);
  const content = new ContentRepository(migrated.database);
  let refreshes = 0;
  const dependencies: ProjectOrderingDependencies = {
    database: migrated.database,
    refreshPreview: () => {
      refreshes += 1;
      return { status: "activated", generation: `generation-${refreshes}` };
    },
  };

  for (const [slug, displayOrder] of [
    ["first", 10],
    ["second", 20],
    ["third", 30],
  ] as const) {
    content.create({
      id: importedContentId("project", slug),
      type: "project",
      slug,
      data: { title: slug },
      displayOrder,
      origin: "import",
    });
  }

  return { content, dependencies, refreshes: () => refreshes };
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("changing Project order", () => {
  test("publishes current Project card order with one collection action", () => {
    const migrated = migratedDatabase();
    directories.push(migrated.directory);
    seedPublishedSite(migrated.database, {
      projects: [
        { slug: "first", order: 0 },
        { slug: "second", order: 1 },
        { slug: "third", order: 2 },
      ],
    });
    new SystemStateRepository(migrated.database).setCutoverPhase("sealed");
    const content = new ContentRepository(migrated.database);
    const second = content.findBySlug("project", "second")!;
    const edited = content.updateIfDraftVersion(
      second.id,
      {
        data: { ...(second.data as object), title: "Private second title" },
      },
      "owner",
      second.draftVersion
    );
    expect(edited.status).toBe("updated");

    expect(
      moveProject(
        { id: second.id, direction: "up" },
        {
          database: migrated.database,
          refreshPreview: () => null,
        }
      ).status
    ).toBe("moved");

    const beforePublication = buildSiteSnapshot(migrated.database, {
      cloudName: "fixture-cloud",
    });
    expect(beforePublication.status).toBe("built");
    if (beforePublication.status === "built") {
      expect(
        beforePublication.snapshot.projects.map((project) => project.slug)
      ).toEqual(["first", "second", "third"]);
    }

    expect(
      publishProjectOrder(
        {},
        {
          database: migrated.database,
          actorGithubUserId: 42,
          refreshPublished: () => null,
        }
      ).status
    ).toBe("published");

    const afterPublication = buildSiteSnapshot(migrated.database, {
      cloudName: "fixture-cloud",
    });
    expect(afterPublication.status).toBe("built");
    if (afterPublication.status === "built") {
      expect(
        afterPublication.snapshot.projects.map((project) => project.slug)
      ).toEqual(["second", "first", "third"]);
      expect(afterPublication.snapshot.projects[0]?.title).toBe(
        "Project second"
      );
    }
    expect(
      (content.findBySlug("project", "second")?.data as { title: string }).title
    ).toBe("Private second title");
  });

  test("rolls back draft and public order when publication fails", () => {
    const migrated = migratedDatabase();
    directories.push(migrated.directory);
    seedPublishedSite(migrated.database, {
      projects: [
        { slug: "first", order: 0 },
        { slug: "second", order: 1 },
      ],
    });
    new SystemStateRepository(migrated.database).setCutoverPhase("sealed");
    const content = new ContentRepository(migrated.database);
    const second = content.findBySlug("project", "second")!;
    expect(
      moveProject(
        { id: second.id, direction: "up" },
        { database: migrated.database, refreshPreview: () => null }
      ).status
    ).toBe("moved");
    migrated.database.exec(`CREATE TRIGGER refuse_project_order_publication
      BEFORE INSERT ON published_revisions
      WHEN NEW.note = 'Published Project order'
      BEGIN SELECT RAISE(ABORT, 'forced order publication failure'); END`);

    expect(() =>
      publishProjectOrder(
        {},
        {
          database: migrated.database,
          actorGithubUserId: 42,
          refreshPublished: () => null,
        }
      )
    ).toThrow("forced order publication failure");
    expect(content.list("project").map((project) => project.slug)).toEqual([
      "second",
      "first",
    ]);
    const published = buildSiteSnapshot(migrated.database, {
      cloudName: "fixture-cloud",
    });
    expect(published.status).toBe("built");
    if (published.status === "built") {
      expect(
        published.snapshot.projects.map((project) => project.slug)
      ).toEqual(["first", "second"]);
    }
  });

  test("refuses Project order publication before publication is enabled", () => {
    const migrated = migratedDatabase();
    directories.push(migrated.directory);
    seedPublishedSite(migrated.database);

    expect(
      publishProjectOrder(
        {},
        {
          database: migrated.database,
          actorGithubUserId: 42,
          refreshPublished: () => null,
        }
      )
    ).toEqual({ status: "disabled" });
  });

  test("moves a Project one position and normalizes every position atomically", () => {
    const { content, dependencies, refreshes } = context();
    const second = content.findBySlug("project", "second")!;

    const outcome = moveProject(
      { id: second.id, direction: "up" },
      dependencies
    );

    expect(outcome).toMatchObject({ status: "moved" });
    expect(content.list("project").map((item) => item.slug)).toEqual([
      "second",
      "first",
      "third",
    ]);
    expect(content.list("project").map((item) => item.displayOrder)).toEqual([
      0, 1, 2,
    ]);
    expect(
      content.list("project").every((item) => item.ownerEditedAt !== null)
    ).toBe(true);
    expect(refreshes()).toBe(1);
  });

  test("does not write or refresh at either boundary", () => {
    const { content, dependencies, refreshes } = context();
    const first = content.list("project")[0]!;
    const beforeVersions = content
      .list("project")
      .map((item) => item.draftVersion);

    expect(
      moveProject({ id: first.id, direction: "up" }, dependencies)
    ).toMatchObject({
      status: "unchanged",
    });
    expect(content.list("project").map((item) => item.draftVersion)).toEqual(
      beforeVersions
    );
    expect(refreshes()).toBe(0);
  });

  test("refuses IDs outside the active Project collection", () => {
    const { dependencies, refreshes } = context();

    expect(
      moveProject({ id: "missing", direction: "down" }, dependencies)
    ).toEqual({ status: "not-found" });
    expect(refreshes()).toBe(0);
  });
});
