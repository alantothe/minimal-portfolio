import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SINGLETON_IDS } from "../content/identity";
import { openDatabase } from "../database/connection";
import { ContentRepository } from "../database/contentRepository";
import { runMigrations } from "../database/migrator";
import {
  archiveCollectionDraft,
  createCollectionDraft,
  type CollectionLifecycleDependencies,
} from "./collectionLifecycle";

const temporaryDirectories: string[] = [];

function context(): {
  database: Database;
  content: ContentRepository;
  dependencies: CollectionLifecycleDependencies;
  refreshes: () => number;
} {
  const directory = mkdtempSync(join(tmpdir(), "collection-lifecycle-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  const content = new ContentRepository(database);
  let refreshCount = 0;
  return {
    database,
    content,
    dependencies: {
      content,
      refreshPreview: () => {
        refreshCount += 1;
        return {
          status: "activated",
          generation: `generation-${refreshCount}`,
        };
      },
    },
    refreshes: () => refreshCount,
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("creating a collection draft", () => {
  test("suggests a normalized slug without writing until the Owner confirms", () => {
    const { content, dependencies, refreshes } = context();

    const outcome = createCollectionDraft(
      { type: "project", title: "Málaga Field Notes" },
      dependencies
    );

    expect(outcome).toEqual({
      status: "confirmation-required",
      suggestedSlug: "malaga-field-notes",
      reason: "generated",
    });
    expect(content.list("project")).toEqual([]);
    expect(refreshes()).toBe(0);
  });

  test("suggests -2 then -3 when former or current routes are reserved", () => {
    const { content, dependencies } = context();
    content.create({
      id: "first",
      type: "project",
      slug: "field-notes",
      data: {},
      origin: "owner",
    });
    const second = content.create({
      id: "second",
      type: "project",
      slug: "field-notes-2",
      data: {},
      origin: "owner",
    });
    content.archiveIfCurrent(second.id, second.updatedAt);

    expect(
      createCollectionDraft(
        { type: "project", title: "Field Notes", slug: "field-notes" },
        dependencies
      )
    ).toEqual({
      status: "confirmation-required",
      suggestedSlug: "field-notes-3",
      reason: "collision",
    });
  });

  test("creates a Project with a random immutable id and draft defaults", () => {
    const { content, dependencies, refreshes } = context();
    content.create({
      id: "existing",
      type: "project",
      slug: "existing",
      data: {},
      displayOrder: 4,
      origin: "owner",
    });

    const outcome = createCollectionDraft(
      { type: "project", title: "New Project", slug: "new-project" },
      dependencies
    );

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.item.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(outcome.item.origin).toBe("owner");
    expect(outcome.item.displayOrder).toBe(5);
    expect(outcome.item.publishedAt).toBeNull();
    expect(outcome.item.data).toEqual({
      title: "New Project",
      summary: "",
      card: null,
      kicker: "",
      role: "",
      status: "",
      period: "",
      technologies: [],
      liveUrl: null,
      repositoryUrl: null,
      accentColor: "",
      bodyMarkdown: "",
      seo: { title: null, description: null, sharingImage: null },
    });
    expect(outcome.route).toBe("/projects/new-project");
    expect(content.findById(outcome.item.id)?.id).toBe(outcome.item.id);
    expect(refreshes()).toBe(1);
  });

  test("creates a Blog post without inventing a Publication date", () => {
    const { dependencies } = context();

    const outcome = createCollectionDraft(
      { type: "blog_post", title: "First Post", slug: "first-post" },
      dependencies
    );

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.item.displayOrder).toBeNull();
    expect(outcome.item.publishedAt).toBeNull();
    expect(outcome.item.data).toEqual({
      title: "First Post",
      excerpt: "",
      bodyMarkdown: "",
      sharingImage: null,
      seo: { title: null, description: null, sharingImage: null },
    });
    expect(outcome.route).toBe("/blog/first-post");
  });

  test("rejects missing titles and malformed confirmed slugs", () => {
    const { content, dependencies } = context();

    expect(
      createCollectionDraft(
        { type: "project", title: "", slug: "valid-slug" },
        dependencies
      )
    ).toEqual({
      status: "invalid",
      findings: [{ field: "title", code: "required", severity: "error" }],
    });
    expect(
      createCollectionDraft(
        { type: "blog_post", title: "Post", slug: "Not Valid" },
        dependencies
      )
    ).toMatchObject({ status: "invalid" });
    expect(content.countByType()).toEqual({});
  });
});

describe("deleting a collection draft", () => {
  test("tombstones identity, reserves the slug, and removes the active item", () => {
    const { content, dependencies, refreshes } = context();
    const project = content.create({
      id: "project-id",
      type: "project",
      slug: "retired-project",
      data: {},
      displayOrder: 0,
      origin: "owner",
    });

    const outcome = archiveCollectionDraft(
      { id: project.id, expectedUpdatedAt: project.updatedAt },
      dependencies
    );

    expect(outcome.status).toBe("archived");
    expect(outcome).toMatchObject({ route: "/projects" });
    expect(content.list("project")).toEqual([]);
    expect(content.findById(project.id)).toBeNull();
    expect(
      content.findIncludingArchivedById(project.id)?.deletedAt
    ).not.toBeNull();
    expect(content.takenSlugs("project")).toContain("retired-project");
    expect(content.isReplaceableByImport(project.id)).toBe(false);
    expect(refreshes()).toBe(1);
  });

  test("refuses singletons and stale browser versions", () => {
    const { content, dependencies, refreshes } = context();
    const home = content.create({
      id: SINGLETON_IDS.home,
      type: "home",
      data: {},
      origin: "import",
    });
    expect(
      archiveCollectionDraft(
        { id: home.id, expectedUpdatedAt: home.updatedAt },
        dependencies
      )
    ).toEqual({ status: "not-deletable" });

    const project = content.create(
      {
        id: "project-id",
        type: "project",
        slug: "project",
        data: {},
        origin: "owner",
      },
      new Date("2026-08-14T19:00:00.000Z")
    );
    content.update(
      project.id,
      { data: { title: "newer" } },
      "owner",
      new Date("2026-08-14T20:00:00.000Z")
    );
    expect(
      archiveCollectionDraft(
        { id: project.id, expectedUpdatedAt: project.updatedAt },
        dependencies
      )
    ).toMatchObject({ status: "conflict" });
    expect(content.findById(project.id)?.deletedAt).toBeNull();
    expect(refreshes()).toBe(0);
  });
});
