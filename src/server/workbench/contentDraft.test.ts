import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { ContentRepository } from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { SINGLETON_IDS, importedContentId } from "../content/identity";
import { migratedDatabase, seedSite } from "../published/fixtures";
import {
  readContentDraft,
  saveContentDraft,
  type DraftDependencies,
} from "./contentDraft";

const directories: string[] = [];
const PROJECT_ID = importedContentId("project", "questurian");
const BLOG_POST_ID = importedContentId("blog_post", "first-post");

function setup(): {
  database: Database;
  dependencies: DraftDependencies;
  previewCalls: { total: number };
} {
  const { database, directory } = migratedDatabase();
  directories.push(directory);
  seedSite(database);
  const previewCalls = { total: 0 };

  return {
    database,
    previewCalls,
    dependencies: {
      content: new ContentRepository(database),
      media: new MediaRepository(database),
      refreshPreview: () => {
        previewCalls.total += 1;
        return { status: "activated", generation: "next" };
      },
    },
  };
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("reading a Content draft", () => {
  test("returns typed content and publish validation", () => {
    const { dependencies } = setup();
    const outcome = readContentDraft(SINGLETON_IDS.home, dependencies);

    expect(outcome.status).toBe("found");
    if (outcome.status === "found") {
      expect(outcome.draft.type).toBe("home");
      expect(outcome.draft.data).toHaveProperty("displayName", "Ada Lovelace");
      expect(outcome.draft.publishFindings).toEqual([]);
    }
  });

  test("returns slug, display order, and Publication date beside typed content", () => {
    const { dependencies } = setup();
    const project = readContentDraft(PROJECT_ID, dependencies);
    const post = readContentDraft(BLOG_POST_ID, dependencies);

    expect(project.status).toBe("found");
    expect(post.status).toBe("found");
    if (project.status === "found") {
      expect(project.draft.type).toBe("project");
      expect(project.draft.slug).toBe("questurian");
      expect(project.draft.displayOrder).toBeNumber();
    }
    if (post.status === "found") {
      expect(post.draft.type).toBe("blog_post");
      expect(post.draft.slug).toBe("first-post");
      expect(post.draft.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("a missing id reports not found", () => {
    const { dependencies } = setup();
    expect(readContentDraft("project:anything", dependencies)).toEqual({
      status: "not-found",
    });
  });
});

describe("saving a Content draft", () => {
  test("normalizes, stores, marks Owner provenance, and refreshes preview", () => {
    const { dependencies, previewCalls } = setup();
    const current = readContentDraft(SINGLETON_IDS.home, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");
    const data = { ...current.draft.data, displayName: "  Grace Hopper  " };

    const outcome = saveContentDraft(
      {
        id: SINGLETON_IDS.home,
        data,
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.draft.data).toHaveProperty("displayName", "Grace Hopper");
      expect(outcome.preview).toEqual({
        status: "activated",
        generation: "next",
      });
    }
    expect(previewCalls.total).toBe(1);
    expect(
      dependencies.content.findById(SINGLETON_IDS.home)?.ownerEditedAt
    ).not.toBeNull();
  });

  test("stores incomplete editorial work but reports publish findings", () => {
    const { dependencies } = setup();
    const current = readContentDraft(SINGLETON_IDS.home, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: SINGLETON_IDS.home,
        data: { ...current.draft.data, displayName: "" },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.draft.publishFindings).toContainEqual({
        field: "displayName",
        code: "required",
        severity: "error",
      });
    }
  });

  test("autosaves a half-written social link for later completion", () => {
    const { dependencies } = setup();
    const current = readContentDraft(SINGLETON_IDS.about, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: SINGLETON_IDS.about,
        data: {
          ...current.draft.data,
          socialLinks: [{ label: "New profile", url: "" }],
        },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.draft.data).toHaveProperty("socialLinks", [
        { label: "New profile", url: "" },
      ]);
      expect(outcome.draft.publishFindings).toContainEqual({
        field: "socialLinks[0].url",
        code: "required",
        severity: "error",
      });
    }
  });

  test("rejects unsafe Markdown without writing or refreshing", () => {
    const { dependencies, previewCalls } = setup();
    const current = readContentDraft(SINGLETON_IDS.home, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: SINGLETON_IDS.home,
        data: { ...current.draft.data, bioMarkdown: "<script>x</script>" },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("invalid");
    expect(previewCalls.total).toBe(0);
    expect(dependencies.content.findById(SINGLETON_IDS.home)?.updatedAt).toBe(
      current.draft.updatedAt
    );
  });

  test("rejects a Media asset id that is not ready", () => {
    const { dependencies } = setup();
    const current = readContentDraft(SINGLETON_IDS.home, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: SINGLETON_IDS.home,
        data: {
          ...current.draft.data,
          portrait: { mediaAssetId: "not-an-asset", alt: "Portrait" },
        },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome).toEqual({
      status: "invalid",
      findings: [
        { field: "portrait", code: "media_unavailable", severity: "error" },
      ],
    });
  });

  test("returns conflict for a stale browser version", () => {
    const { dependencies } = setup();
    const current = readContentDraft(SINGLETON_IDS.home, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");
    dependencies.content.update(
      SINGLETON_IDS.home,
      { data: current.draft.data },
      "owner",
      new Date("2026-08-14T20:00:00.000Z")
    );

    const outcome = saveContentDraft(
      {
        id: SINGLETON_IDS.home,
        data: current.draft.data,
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome).toEqual({
      status: "conflict",
      currentUpdatedAt: "2026-08-14T20:00:00.000Z",
    });
  });

  test("autosaves Project fields, slug, and manual order", () => {
    const { dependencies } = setup();
    const current = readContentDraft(PROJECT_ID, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: PROJECT_ID,
        data: { ...current.draft.data, title: "Questurian Next" },
        attributes: { slug: "questurian-next", displayOrder: 7 },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.draft.data).toHaveProperty("title", "Questurian Next");
      expect(outcome.draft.slug).toBe("questurian-next");
      expect(outcome.draft.displayOrder).toBe(7);
    }
  });

  test("stores a missing slug and display order but reports publish findings", () => {
    const { dependencies } = setup();
    const current = readContentDraft(PROJECT_ID, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: PROJECT_ID,
        data: current.draft.data,
        attributes: { slug: "", displayOrder: null },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.draft.slug).toBe("");
      expect(outcome.draft.displayOrder).toBeNull();
      expect(outcome.draft.publishFindings).toContainEqual({
        field: "slug",
        code: "required",
        severity: "error",
      });
      expect(outcome.draft.publishFindings).toContainEqual({
        field: "displayOrder",
        code: "required",
        severity: "error",
      });
    }
  });

  test("rejects a duplicate collection slug", () => {
    const { dependencies } = setup();
    const current = readContentDraft(PROJECT_ID, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: PROJECT_ID,
        data: current.draft.data,
        attributes: { slug: "minimal-portfolio", displayOrder: 1 },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome).toEqual({
      status: "invalid",
      findings: [{ field: "slug", code: "duplicate_slug", severity: "error" }],
    });
  });

  test("rejects a Publication date sent for a Project", () => {
    const { dependencies } = setup();
    const current = readContentDraft(PROJECT_ID, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: PROJECT_ID,
        data: current.draft.data,
        attributes: {
          slug: "questurian",
          displayOrder: 1,
          publishedAt: "2026-01-01",
        },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome).toEqual({
      status: "invalid",
      findings: [
        {
          field: "attributes.publishedAt",
          code: "unknown_field",
          severity: "error",
        },
      ],
    });
  });

  test("rejects a future Blog publication date", () => {
    const { dependencies } = setup();
    const current = readContentDraft(BLOG_POST_ID, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: BLOG_POST_ID,
        data: current.draft.data,
        attributes: { slug: "first-post", publishedAt: "2999-01-01" },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome).toEqual({
      status: "invalid",
      findings: [
        {
          field: "publishedAt",
          code: "future_publication_date",
          severity: "error",
        },
      ],
    });
  });

  test("autosaves Blog post fields, slug, and publication date", () => {
    const { dependencies } = setup();
    const current = readContentDraft(BLOG_POST_ID, dependencies);
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveContentDraft(
      {
        id: BLOG_POST_ID,
        data: { ...current.draft.data, title: "Updated Blog post" },
        attributes: {
          slug: "updated-post",
          publishedAt: "2026-02-01",
        },
        expectedUpdatedAt: current.draft.updatedAt,
      },
      dependencies
    );

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.draft.data).toHaveProperty("title", "Updated Blog post");
      expect(outcome.draft.slug).toBe("updated-post");
      expect(outcome.draft.publishedAt).toBe("2026-02-01");
    }
  });
});
