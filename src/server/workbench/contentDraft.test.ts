import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { ContentRepository } from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { SINGLETON_IDS } from "../content/identity";
import { migratedDatabase, seedSite } from "../published/fixtures";
import {
  readSingletonDraft,
  saveSingletonDraft,
  type DraftDependencies,
} from "./contentDraft";

const directories: string[] = [];

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

describe("reading a singleton Content draft", () => {
  test("returns typed content and publish validation", () => {
    const { dependencies } = setup();
    const outcome = readSingletonDraft(
      SINGLETON_IDS.home,
      dependencies.content
    );

    expect(outcome.status).toBe("found");
    if (outcome.status === "found") {
      expect(outcome.draft.type).toBe("home");
      expect(outcome.draft.data).toHaveProperty("displayName", "Ada Lovelace");
      expect(outcome.draft.publishFindings).toEqual([]);
    }
  });

  test("collection ids are outside 7b", () => {
    const { dependencies } = setup();
    expect(
      readSingletonDraft("project:anything", dependencies.content)
    ).toEqual({ status: "not-found" });
  });
});

describe("saving a singleton Content draft", () => {
  test("normalizes, stores, marks Owner provenance, and refreshes preview", () => {
    const { dependencies, previewCalls } = setup();
    const current = readSingletonDraft(
      SINGLETON_IDS.home,
      dependencies.content
    );
    if (current.status !== "found") throw new Error("missing fixture");
    const data = { ...current.draft.data, displayName: "  Grace Hopper  " };

    const outcome = saveSingletonDraft(
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
    const current = readSingletonDraft(
      SINGLETON_IDS.home,
      dependencies.content
    );
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveSingletonDraft(
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
    const current = readSingletonDraft(
      SINGLETON_IDS.about,
      dependencies.content
    );
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveSingletonDraft(
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
    const current = readSingletonDraft(
      SINGLETON_IDS.home,
      dependencies.content
    );
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveSingletonDraft(
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
    const current = readSingletonDraft(
      SINGLETON_IDS.home,
      dependencies.content
    );
    if (current.status !== "found") throw new Error("missing fixture");

    const outcome = saveSingletonDraft(
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
    const current = readSingletonDraft(
      SINGLETON_IDS.home,
      dependencies.content
    );
    if (current.status !== "found") throw new Error("missing fixture");
    dependencies.content.update(
      SINGLETON_IDS.home,
      { data: current.draft.data },
      "owner",
      new Date("2026-08-14T20:00:00.000Z")
    );

    const outcome = saveSingletonDraft(
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
});
