/**
 * The library is derived from a generation, so these tests drive it from a real
 * one rather than a hand-built object. A fixture that agreed with the code but
 * not with the snapshot builder would prove nothing about the pane the owner
 * actually sees.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { buildSiteSnapshot } from "../published/snapshot";
import type { SiteSnapshot } from "../published/snapshot";
import {
  FIXTURE_CLOUD_NAME,
  migratedDatabase,
  seedSite,
} from "../published/fixtures";
import {
  contentLibrary,
  defaultPreviewRoute,
  isPreviewableRoute,
} from "./library";

const directories: string[] = [];

function snapshot(): SiteSnapshot {
  const { database, directory } = migratedDatabase();
  directories.push(directory);
  seedSite(database as Database);

  const build = buildSiteSnapshot(database as Database, {
    cloudName: FIXTURE_CLOUD_NAME,
  });
  if (build.status !== "built") {
    throw new Error(`fixture did not build: ${JSON.stringify(build.findings)}`);
  }
  return build.snapshot;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("the content library", () => {
  test("has exactly the three groups #44 fixes", () => {
    const sections = contentLibrary(snapshot());

    expect(sections.map((section) => section.label)).toEqual([
      "Pages",
      "Projects",
      "Blog posts",
    ]);
  });

  test("every entry names a route the generation publishes", () => {
    const site = snapshot();

    for (const section of contentLibrary(site)) {
      for (const entry of section.entries) {
        // The pane's whole promise is that selecting an entry shows you its
        // effect. An entry pointing at an unpublished route breaks that
        // silently — the iframe just 404s.
        expect(isPreviewableRoute(site, entry.route)).toBe(true);
      }
    }
  });

  test("entry ids are unique, so selection cannot be ambiguous", () => {
    const ids = contentLibrary(snapshot()).flatMap((section) =>
      section.entries.map((entry) => entry.id)
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("projects and posts come from the generation, not a fixed list", () => {
    const site = snapshot();
    const sections = contentLibrary(site);

    const projects = sections.find((section) => section.id === "projects")!;
    const posts = sections.find((section) => section.id === "blog-posts")!;

    expect(projects.entries).toHaveLength(site.projects.length);
    expect(posts.entries).toHaveLength(site.blogPosts.length);
    expect(projects.entries.map((entry) => entry.label)).toEqual(
      site.projects.map((project) => project.title)
    );
  });

  test("a post with no publication date shows no date rather than 'null'", () => {
    const site = snapshot();
    const posts = contentLibrary(site).find(
      (section) => section.id === "blog-posts"
    )!;

    for (const entry of posts.entries) {
      expect(entry.supportingText).not.toContain("null");
      if (entry.supportingText !== "")
        expect(entry.supportingText).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("preview route validation", () => {
  test("refuses a route the generation does not publish", () => {
    const site = snapshot();

    expect(isPreviewableRoute(site, "/admin")).toBe(false);
    expect(isPreviewableRoute(site, "/../etc/passwd")).toBe(false);
    expect(isPreviewableRoute(site, "https://elsewhere.test/")).toBe(false);
    expect(isPreviewableRoute(site, "")).toBe(false);
  });

  test("accepts the default route, so the pane always has somewhere to start", () => {
    expect(isPreviewableRoute(snapshot(), defaultPreviewRoute())).toBe(true);
  });
});
