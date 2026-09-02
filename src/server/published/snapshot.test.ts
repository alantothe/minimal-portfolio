/**
 * What one generation is, and what it refuses to be.
 *
 * The interesting cases here are all failures. A snapshot that builds correctly
 * from good content is the easy half; the half that matters is that a missing
 * singleton, an unreadable schema version, or a duplicate route produces *no*
 * generation rather than a partial one, because a partial generation is the one
 * outcome #34 says a Visitor must never be able to reach.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { ContentRepository } from "../database/contentRepository";
import { SINGLETON_IDS, importedContentId } from "../content/identity";
import {
  buildDraftPreviewSnapshot,
  buildSiteSnapshot,
  type SiteSnapshot,
} from "./snapshot";
import {
  FIXTURE_CLOUD_NAME,
  migratedDatabase,
  seedPublishedRevisions,
  seedPublishedSite,
  seedSite,
} from "./fixtures";

const directories: string[] = [];

function database(): Database {
  const { database: db, directory } = migratedDatabase();
  directories.push(directory);
  return db;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

function built(db: Database): SiteSnapshot {
  const build = buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME });
  if (build.status !== "built") {
    throw new Error(
      `expected a generation, got findings: ${JSON.stringify(build.findings)}`
    );
  }
  return build.snapshot;
}

function codes(db: Database): string[] {
  const build = buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME });
  return build.status === "invalid"
    ? build.findings.map((finding) => finding.code)
    : [];
}

describe("building a generation", () => {
  test("loads every content type into one snapshot", () => {
    const db = database();
    seedPublishedSite(db);

    const snapshot = built(db);

    expect(snapshot.home.displayName).toBe("Ada Lovelace");
    expect(snapshot.about.featuredTitle).toBe("Example");
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.projects[0]?.technologies).toEqual(["Bun", "TypeScript"]);
    expect(snapshot.blogPosts).toHaveLength(1);
  });

  test("derives the first name rather than storing it", () => {
    const db = database();
    seedPublishedSite(db);

    expect(built(db).home.firstName).toBe("Ada");
  });

  test("orders projects by the owner's display order", () => {
    const db = database();
    seedPublishedSite(db, {
      projects: [
        { slug: "second", order: 2 },
        { slug: "first", order: 1 },
      ],
    });

    expect(built(db).projects.map((p) => p.slug)).toEqual(["first", "second"]);
  });

  test("orders blog posts newest first", () => {
    const db = database();
    seedPublishedSite(db, {
      blogPosts: [
        { slug: "older", date: "2025-01-01" },
        { slug: "newer", date: "2026-06-01" },
      ],
    });

    expect(built(db).blogPosts.map((p) => p.slug)).toEqual(["newer", "older"]);
  });

  test("renders markdown once, at build time", () => {
    const db = database();
    seedPublishedSite(db);

    const project = built(db).projects[0]!;

    expect(project.bodyHtml).toContain("<h2>Context</h2>");
    expect(project.bodyHtml).toContain("<h3>Detail</h3>");
    // The source is gone from the snapshot; only the rendered form travels.
    expect(project.bodyHtml).not.toContain("## Context");
  });

  test("splits the about featured body into its paragraphs", () => {
    const db = database();
    seedPublishedSite(db);

    expect(built(db).about.featuredBodyParagraphs).toHaveLength(3);
  });
});

describe("building an owner draft preview", () => {
  test("renders editorially incomplete content that publication refuses", () => {
    const db = database();
    seedPublishedSite(db);
    const repository = new ContentRepository(db);
    repository.update(
      SINGLETON_IDS.home,
      {
        data: {
          ...(repository.findById(SINGLETON_IDS.home)!.data as object),
          displayName: "",
          professionalTitle: "Work in progress",
        },
      },
      "owner"
    );

    expect(buildSiteSnapshot(db).status).toBe("built");
    const preview = buildDraftPreviewSnapshot(db);
    expect(preview.status).toBe("built");
    if (preview.status === "built") {
      expect(preview.snapshot.home.displayName).toBe("");
      expect(preview.snapshot.home.professionalTitle).toBe("Work in progress");
    }
  });

  test("retains missing slug, display order, and Publication date in preview", () => {
    const db = database();
    seedPublishedSite(db);
    const repository = new ContentRepository(db);
    repository.update(
      importedContentId("project", "questurian"),
      { slug: "", displayOrder: null },
      "owner"
    );
    repository.update(
      importedContentId("blog_post", "first-post"),
      { slug: "", publishedAt: null },
      "owner"
    );

    const publication = buildSiteSnapshot(db);
    expect(publication.status).toBe("built");
    const preview = buildDraftPreviewSnapshot(db);
    expect(preview.status).toBe("built");
    if (preview.status === "built") {
      expect(preview.snapshot.projects[0]?.route).toBe("/projects");
      expect(preview.snapshot.blogPosts[0]?.route).toBe("/blog");
      expect(new Set(preview.snapshot.routes).size).toBe(
        preview.snapshot.routes.length
      );
    }
  });
});

describe("media", () => {
  test("resolves each role at its own variant", () => {
    const db = database();
    seedPublishedSite(db);
    const snapshot = built(db);

    // Article media uses a wider source than collection cards; Project CSS
    // applies the shared 1440x900 display crop without enlarging card downloads.
    expect(snapshot.home.portrait).toMatchObject({ width: 800, height: 800 });
    expect(snapshot.projects[0]!.card).toMatchObject({
      width: 600,
      height: 360,
    });
    expect(snapshot.projects[0]!.lead).toMatchObject({
      width: 1200,
      height: 720,
    });
    expect(snapshot.branding.defaultSharingImage).toMatchObject({
      width: 1200,
      height: 630,
    });
  });

  test("builds delivery URLs through the closed variant enum", () => {
    const db = database();
    seedPublishedSite(db);

    const url = built(db).home.portrait!.url;

    expect(url).toStartWith(
      `https://res.cloudinary.com/${FIXTURE_CLOUD_NAME}/image/upload/t_portfolio_avatar/`
    );
  });

  test("a page still builds when its image cannot be rendered", () => {
    const db = database();
    const { portraitId } = seedPublishedSite(db);

    db.query("UPDATE media_assets SET status = 'tombstoned' WHERE id = ?").run(
      portraitId
    );

    const snapshot = built(db);

    // #34: Cloudinary trouble degrades the image, never the page.
    expect(snapshot.home.portrait).toBeNull();
    expect(snapshot.home.displayName).toBe("Ada Lovelace");
  });

  test("unconfigured media disables images without failing the build", () => {
    const db = database();
    seedPublishedSite(db);

    const build = buildSiteSnapshot(db, { cloudName: "" });

    expect(build.status).toBe("built");
    if (build.status !== "built") return;
    expect(build.snapshot.home.portrait).toBeNull();
  });
});

describe("refusing to build", () => {
  test("a missing singleton produces no generation at all", () => {
    const db = database();
    seedPublishedSite(db, { omit: ["about"] });

    expect(codes(db)).toContain("singleton_missing");
  });

  test("a private draft written by a newer release cannot poison public content", () => {
    const db = database();
    seedPublishedSite(db);

    db.query("UPDATE content_items SET schema_version = 99 WHERE id = ?").run(
      SINGLETON_IDS.home
    );

    expect(buildSiteSnapshot(db).status).toBe("built");
  });

  test("content that would not publish blocks a Published generation", () => {
    const db = database();
    seedSite(db);

    // A stored row that no longer validates is exactly the rollback case: an
    // older renderer meeting content it cannot fully interpret.
    new ContentRepository(db).update(
      importedContentId("project", "questurian"),
      { data: { title: "", summary: "", bodyMarkdown: "" } },
      "import"
    );
    seedPublishedRevisions(db);

    expect(codes(db).length).toBeGreaterThan(0);
  });

  test("malformed Public route slug and display order block the generation", () => {
    const db = database();
    seedSite(db);
    const repository = new ContentRepository(db);
    repository.update(
      importedContentId("project", "questurian"),
      { slug: "Bad Slug", displayOrder: -1 },
      "owner"
    );
    seedPublishedRevisions(db);

    expect(codes(db)).toContain("malformed_slug");
    expect(codes(db)).toContain("invalid_display_order");
  });

  test("nothing is returned alongside findings", () => {
    const db = database();
    seedPublishedSite(db, { omit: ["home"] });

    const build = buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME });

    expect(build.status).toBe("invalid");
    expect(build).not.toHaveProperty("snapshot");
  });

  test("private drafts never become a Published generation implicitly", () => {
    const db = database();
    seedSite(db);

    const build = buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME });

    expect(build.status).toBe("invalid");
    expect(build).not.toHaveProperty("snapshot");
    if (build.status === "invalid") {
      expect(build.findings.map((finding) => finding.code)).toContain(
        "singleton_missing"
      );
    }
  });
});

describe("generation identity", () => {
  test("the same content produces the same generation twice", () => {
    const db = database();
    seedPublishedSite(db);

    expect(built(db).generation).toBe(built(db).generation);
  });

  test("editing a private draft does not change the Published generation", () => {
    const db = database();
    seedPublishedSite(db);
    const before = built(db).generation;

    new ContentRepository(db).update(
      SINGLETON_IDS.home,
      { data: { ...(builtHomeData(db) as object), displayName: "Ada L." } },
      "owner"
    );

    expect(built(db).generation).toBe(before);
  });

  test("replacing an image changes the generation", () => {
    const db = database();
    const { portraitId } = seedPublishedSite(db);
    const before = built(db).generation;

    db.query(
      "UPDATE media_assets SET provider_version = '1800000000' WHERE id = ?"
    ).run(portraitId);

    // Content did not move, but what a Visitor sees did. An ETag derived from a
    // generation that ignored media would survive an image swap.
    expect(built(db).generation).not.toBe(before);
  });
});

describe("route manifest", () => {
  test("lists every canonical route once, with page one unsuffixed", () => {
    const db = database();
    seedPublishedSite(db);

    const routes = built(db).routes;

    expect(routes).toContain("/");
    expect(routes).toContain("/about");
    expect(routes).toContain("/blog");
    expect(routes).toContain("/projects");
    expect(routes).toContain("/blog/first-post");
    expect(routes).toContain("/projects/questurian");
    expect(new Set(routes).size).toBe(routes.length);
  });

  test("adds a page for each additional collection page", () => {
    const db = database();
    seedPublishedSite(db, {
      blogPosts: Array.from({ length: 5 }, (_, index) => ({
        slug: `post-${index}`,
        date: `2026-01-0${index + 1}`,
      })),
    });

    // Five posts at four per page is two pages.
    expect(built(db).routes).toContain("/blog?page=2");
  });
});

function builtHomeData(db: Database): unknown {
  return new ContentRepository(db).findById(SINGLETON_IDS.home)!.data;
}
