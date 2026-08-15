import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { migratedDatabase, seedSite } from "../published/fixtures";
import { ContentRepository } from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { PublicationRepository } from "../database/publicationRepository";
import { SystemStateRepository } from "../database/repository";
import { buildSiteSnapshot } from "../published/snapshot";
import { PublishedSite } from "../published/site";
import { publishContent, restorePublishedRevision } from "./publication";

const directories: string[] = [];
afterEach(() => {
  while (directories.length)
    rmSync(directories.pop()!, { recursive: true, force: true });
});

function setup() {
  const migrated = migratedDatabase();
  directories.push(migrated.directory);
  seedSite(migrated.database);
  const content = new ContentRepository(migrated.database);
  const publication = new PublicationRepository(migrated.database);
  const baseline = new Date("2026-08-01T12:00:00.000Z");
  for (const type of [
    "home",
    "about",
    "branding",
    "project",
    "blog_post",
  ] as const) {
    for (const item of content.list(type))
      publication.seedMigrationRevision(item, baseline);
  }
  new SystemStateRepository(migrated.database).setCutoverPhase("sealed");
  return {
    database: migrated.database,
    content,
    publication,
    dependencies: {
      database: migrated.database,
      refreshPublished: () => null,
      refreshPreview: () => null,
    },
  };
}

function editHome(database: Database, suffix: string) {
  const content = new ContentRepository(database);
  const home = content.findSingleton("home")!;
  const data = {
    ...(home.data as Record<string, unknown>),
    professionalTitle: `Engineer ${suffix}`,
  };
  const update = content.updateIfDraftVersion(
    home.id,
    { data },
    "owner",
    home.draftVersion
  );
  if (update.status !== "updated") throw new Error("fixture edit failed");
  return update.item;
}

function publishHome(
  database: Database,
  key: string,
  now = new Date("2026-08-14T12:00:00.000Z")
) {
  const home = new ContentRepository(database).findSingleton("home")!;
  return publishContent(
    {
      contentId: home.id,
      expectedDraftVersion: home.draftVersion,
      idempotencyKey: key,
      actorGithubUserId: 42,
      now,
    },
    { database, refreshPublished: () => null, refreshPreview: () => null }
  );
}

describe("publishing a Content draft", () => {
  test("a draft edit cannot change the published snapshot before publication", () => {
    const { database } = setup();
    const before = buildSiteSnapshot(database, { cloudName: "fixture-cloud" });
    editHome(database, "Private draft");
    const after = buildSiteSnapshot(database, { cloudName: "fixture-cloud" });
    expect(before.status).toBe("built");
    expect(after.status).toBe("built");
    if (before.status === "built" && after.status === "built") {
      expect(after.snapshot.generation).toBe(before.snapshot.generation);
      expect(after.snapshot.home.professionalTitle).toBe(
        before.snapshot.home.professionalTitle
      );
    }
  });

  test("atomically creates an immutable revision and moves only its public pointer", () => {
    const { database, publication } = setup();
    const edited = editHome(database, "Two");
    const outcome = publishHome(
      database,
      "11111111-1111-4111-8111-111111111111"
    );
    expect(outcome.status).toBe("published");
    expect(publication.currentRevision(edited.id)?.revisionNumber).toBe(2);
    expect(publication.listRevisions(edited.id)).toHaveLength(2);
    expect(() =>
      database.query("UPDATE published_revisions SET note = 'changed'").run()
    ).toThrow("immutable");
    expect(() =>
      database.query("DELETE FROM published_revisions").run()
    ).toThrow("cannot be deleted");
  });

  test("refuses stale, invalid, and no-op publication", () => {
    const { database, content } = setup();
    const home = content.findSingleton("home")!;
    expect(
      publishContent(
        {
          contentId: home.id,
          expectedDraftVersion: home.draftVersion - 1,
          idempotencyKey: "22222222-2222-4222-8222-222222222222",
          actorGithubUserId: 42,
        },
        { database, refreshPublished: () => null, refreshPreview: () => null }
      ).status
    ).toBe("conflict");
    expect(
      publishHome(database, "33333333-3333-4333-8333-333333333333").status
    ).toBe("no-change");
    const invalid = content.updateIfDraftVersion(
      home.id,
      { data: { ...(home.data as object), displayName: "" } },
      "owner",
      home.draftVersion
    );
    expect(invalid.status).toBe("updated");
    expect(
      publishHome(database, "44444444-4444-4444-8444-444444444444").status
    ).toBe("invalid");
  });

  test("replays an idempotency key without creating another revision", () => {
    const { database, publication } = setup();
    const edited = editHome(database, "Idempotent");
    const key = "55555555-5555-4555-8555-555555555555";
    expect(publishHome(database, key).status).toBe("published");
    expect(publishHome(database, key).status).toBe("replayed");
    expect(publication.listRevisions(edited.id)).toHaveLength(2);
  });

  test("defaults the first Blog publication date once", () => {
    const { database, content } = setup();
    const post = content.create({
      id: "11111111-aaaa-4aaa-8aaa-111111111111",
      type: "blog_post",
      slug: "new-post",
      publishedAt: null,
      origin: "owner",
      data: {
        title: "New post",
        excerpt: "A useful complete excerpt.",
        bodyMarkdown: "## Opening\n\nA complete body.",
        sharingImage: null,
        seo: { title: null, description: null, sharingImage: null },
      },
    });
    const outcome = publishContent(
      {
        contentId: post.id,
        expectedDraftVersion: post.draftVersion,
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
        actorGithubUserId: 42,
        now: new Date("2026-08-14T23:59:00.000Z"),
      },
      { database, refreshPublished: () => null, refreshPreview: () => null }
    );
    expect(outcome.status).toBe("published");
    expect(new ContentRepository(database).findById(post.id)?.publishedAt).toBe(
      "2026-08-14"
    );
  });
});

describe("history, restore, and routes", () => {
  test("restore changes only the draft; restore-publish creates a new top revision", () => {
    const { database, content, publication, dependencies } = setup();
    const home = content.findSingleton("home")!;
    const revisionOne = publication.currentRevision(home.id)!;
    editHome(database, "Later");
    expect(
      publishHome(database, "77777777-7777-4777-8777-777777777777").status
    ).toBe("published");
    const currentBeforeRestore = publication.currentRevision(home.id)!;
    const draft = content.findById(home.id)!;
    const restored = restorePublishedRevision(
      {
        contentId: home.id,
        revisionId: revisionOne.id,
        expectedDraftVersion: draft.draftVersion,
        actorGithubUserId: 42,
      },
      dependencies
    );
    expect(restored.status).toBe("restored");
    expect(publication.currentRevision(home.id)?.id).toBe(
      currentBeforeRestore.id
    );
    const published = publishHome(
      database,
      "88888888-8888-4888-8888-888888888888"
    );
    expect(published.status).toBe("published");
    if (published.status === "published") {
      expect(published.revision.revisionNumber).toBe(3);
      expect(published.revision.source).toBe("restore-publish");
      expect(published.revision.restoredFromRevisionId).toBe(revisionOne.id);
    }
  });

  test("a slug change creates a direct 308 map and keeps the former route reserved", () => {
    const { database, content, publication } = setup();
    const project = content.list("project")[0]!;
    const oldRoute = `/projects/${project.slug}`;
    const moved = content.updateIfDraftVersion(
      project.id,
      { slug: "moved-project" },
      "owner",
      project.draftVersion
    );
    if (moved.status !== "updated") throw new Error("fixture move failed");
    const outcome = publishContent(
      {
        contentId: project.id,
        expectedDraftVersion: moved.item.draftVersion,
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
        actorGithubUserId: 42,
      },
      { database, refreshPublished: () => null, refreshPreview: () => null }
    );
    expect(outcome.status).toBe("published");
    expect(publication.routeRedirects()[oldRoute]).toBe(
      "/projects/moved-project"
    );

    const build = buildSiteSnapshot(database, { cloudName: "fixture-cloud" });
    expect(build.status).toBe("built");
    if (build.status === "built") {
      const site = new PublishedSite(() => build);
      site.refresh();
      expect(
        site.resolveUrl(new URL(oldRoute, "https://example.test"))
      ).toEqual({
        outcome: "redirect",
        location: "/projects/moved-project",
      });
    }
  });

  test("another item cannot claim history, while the original item can return without chains", () => {
    const { database, content, publication } = setup();
    const [first, second] = content.list("project");
    const oldRoute = `/projects/${first!.slug}`;
    const firstMove = content.updateIfDraftVersion(
      first!.id,
      { slug: "first-move" },
      "owner",
      first!.draftVersion
    );
    if (firstMove.status !== "updated") throw new Error("fixture move failed");
    expect(
      publishContent(
        {
          contentId: first!.id,
          expectedDraftVersion: firstMove.item.draftVersion,
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          actorGithubUserId: 42,
        },
        { database, refreshPublished: () => null, refreshPreview: () => null }
      ).status
    ).toBe("published");

    const steal = content.updateIfDraftVersion(
      second!.id,
      { slug: first!.slug },
      "owner",
      second!.draftVersion
    );
    if (steal.status !== "updated") throw new Error("fixture steal failed");
    expect(
      publishContent(
        {
          contentId: second!.id,
          expectedDraftVersion: steal.item.draftVersion,
          idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          actorGithubUserId: 42,
        },
        { database, refreshPublished: () => null, refreshPreview: () => null }
      ).status
    ).toBe("invalid");

    // Give the second draft its own address again, then let the first Content
    // return to the route it owns.
    const secondReset = content.updateIfDraftVersion(
      second!.id,
      { slug: "second-reset" },
      "owner",
      steal.item.draftVersion
    );
    if (secondReset.status !== "updated")
      throw new Error("fixture reset failed");
    const firstCurrent = content.findById(first!.id)!;
    const returned = content.updateIfDraftVersion(
      first!.id,
      { slug: first!.slug },
      "owner",
      firstCurrent.draftVersion
    );
    if (returned.status !== "updated") throw new Error("fixture return failed");
    expect(
      publishContent(
        {
          contentId: first!.id,
          expectedDraftVersion: returned.item.draftVersion,
          idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          actorGithubUserId: 42,
        },
        { database, refreshPublished: () => null, refreshPreview: () => null }
      ).status
    ).toBe("published");
    expect(publication.routeRedirects()).toEqual({
      "/projects/first-move": oldRoute,
    });
  });
});
