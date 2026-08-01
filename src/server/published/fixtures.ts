/**
 * A deterministic published site, for tests and rehearsals.
 *
 * Written against the real repositories and the real migrations rather than as
 * an object literal, because most of what the snapshot builder can get wrong is
 * a storage-shaped mistake — a singleton that is missing, a slug that collides,
 * a media row that is not `ready`. A fixture that skipped SQLite would prove
 * only that the builder agrees with itself.
 *
 * Deliberately not a copy of the live content. These tests check the *rules*;
 * the shadow parity run in `shadow.ts` is what checks the real content, and
 * pinning production copy here would make every editorial change a test failure.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database/connection";
import { runMigrations } from "../database/migrator";
import { ContentRepository } from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { SINGLETON_IDS, importedContentId } from "../content/identity";

export const FIXTURE_CLOUD_NAME = "fixture-cloud";

export function migratedDatabase(): { database: Database; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "published-site-"));
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return { database, directory };
}

/**
 * A ready Media asset.
 *
 * Goes through `beginUpload` then `finalizeUpload` rather than inserting a row
 * directly, so the trigger that refuses a `ready` row without provider metadata
 * is exercised by the fixture instead of bypassed by it.
 */
export function readyAsset(
  database: Database,
  id: string,
  size: { width: number; height: number } = { width: 1200, height: 630 }
): string {
  const media = new MediaRepository(database);
  const asset = media.beginUpload({
    id,
    providerPublicId: `portfolio/${id}`,
    originalFilename: `${id}.png`,
  });

  media.finalizeUpload(asset.id, {
    providerAssetId: `provider-${id}`,
    providerVersion: "1700000000",
    format: "png",
    bytes: 4096,
    width: size.width,
    height: size.height,
  });

  return asset.id;
}

export interface SeedOptions {
  projects?: Array<{ slug: string; order: number; title?: string }>;
  blogPosts?: Array<{ slug: string; date: string; title?: string }>;
  /** Omit a singleton, to check that a generation refuses to build without it. */
  omit?: Array<"home" | "about" | "branding">;
  homeBio?: string;
}

const DEFAULT_PROJECTS: NonNullable<SeedOptions["projects"]> = [
  { slug: "questurian", order: 1 },
  { slug: "minimal-portfolio", order: 2 },
];

const DEFAULT_POSTS: NonNullable<SeedOptions["blogPosts"]> = [
  { slug: "first-post", date: "2026-01-15" },
];

/**
 * Writes a complete site.
 *
 * Returns the media ids so a test can tombstone one and check that a page with
 * an unrenderable image still serves.
 */
export function seedSite(
  database: Database,
  options: SeedOptions = {}
): { portraitId: string; logoId: string; sharingId: string; cardId: string } {
  const content = new ContentRepository(database);
  const omit = new Set(options.omit ?? []);

  const portraitId = readyAsset(database, "asset-portrait", {
    width: 512,
    height: 510,
  });
  const logoId = readyAsset(database, "asset-logo", {
    width: 337,
    height: 203,
  });
  const sharingId = readyAsset(database, "asset-sharing");
  const cardId = readyAsset(database, "asset-card", {
    width: 1200,
    height: 720,
  });

  if (!omit.has("home")) {
    content.create({
      id: SINGLETON_IDS.home,
      type: "home",
      slug: null,
      origin: "import",
      data: {
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        githubUsername: "ada",
        professionalTitle: "Founding Engineer at Example",
        introMarkdown:
          "Hi there, I'm Ada. I'm a **Founding Engineer at Example**, building things.",
        bioMarkdown:
          options.homeBio ??
          "I built this to showcase my [projects](/projects). Feel free to [reach out](mailto:ada@example.com).",
        portrait: { mediaAssetId: portraitId, alt: "Ada Lovelace" },
        seo: { title: null, description: null, sharingImage: null },
      },
    });
  }

  if (!omit.has("about")) {
    content.create({
      id: SINGLETON_IDS.about,
      type: "about",
      slug: null,
      origin: "import",
      data: {
        introMarkdown: "I write software and read about bridges.",
        hobbiesMarkdown: "Outside work I climb and cook badly.",
        socialLinks: [
          { label: "GitHub", url: "https://github.com/ada" },
          { label: "LinkedIn", url: "https://linkedin.com/in/ada" },
        ],
        featuredTitle: "Example",
        featuredBodyMarkdown:
          "First paragraph about the work.\n\nSecond paragraph with more detail.\n\nThird paragraph closing it out.",
        seo: { title: null, description: null, sharingImage: null },
      },
    });
  }

  if (!omit.has("branding")) {
    content.create({
      id: SINGLETON_IDS.branding,
      type: "branding",
      slug: null,
      origin: "import",
      data: {
        logo: { mediaAssetId: logoId, alt: "Ada Lovelace" },
        defaultSharingImage: { mediaAssetId: sharingId, alt: "Ada Lovelace" },
      },
    });
  }

  for (const project of options.projects ?? DEFAULT_PROJECTS) {
    content.create({
      id: importedContentId("project", project.slug),
      type: "project",
      slug: project.slug,
      displayOrder: project.order,
      origin: "import",
      data: {
        title: project.title ?? `Project ${project.slug}`,
        summary: `What ${project.slug} is for.`,
        card: { mediaAssetId: cardId, alt: `Project ${project.slug}` },
        kicker: "Selected project",
        role: "Founding Engineer",
        status: "Live",
        period: "2025–present",
        technologies: ["TypeScript", "SQLite"],
        liveUrl: null,
        repositoryUrl: "https://github.com/ada/example",
        accentColor: "#8aa0b2",
        bodyMarkdown: `## Context\n\nSome body copy for ${project.slug}.\n\n### Detail\n\nMore copy.`,
        seo: { title: null, description: null, sharingImage: null },
      },
    });
  }

  for (const post of options.blogPosts ?? DEFAULT_POSTS) {
    content.create({
      id: importedContentId("blog_post", post.slug),
      type: "blog_post",
      slug: post.slug,
      publishedAt: post.date,
      origin: "import",
      data: {
        title: post.title ?? `Post ${post.slug}`,
        excerpt: `A short summary of ${post.slug}.`,
        bodyMarkdown: `## Opening\n\nThe body of ${post.slug}.`,
        sharingImage: null,
        seo: { title: null, description: null, sharingImage: null },
      },
    });
  }

  return { portraitId, logoId, sharingId, cardId };
}
