import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ContentRepository } from "../database/contentRepository";
import { importedContentId } from "../content/identity";
import { migratedDatabase } from "../published/fixtures";
import {
  moveProject,
  type ProjectOrderingDependencies,
} from "./projectOrdering";

const directories: string[] = [];

function context() {
  const migrated = migratedDatabase();
  directories.push(migrated.directory);
  const content = new ContentRepository(migrated.database);
  let refreshes = 0;
  const dependencies: ProjectOrderingDependencies = {
    content,
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
