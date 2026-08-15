/**
 * The four answers, and the rule that decides between them.
 *
 * Most of this file is about the difference between "this route does not exist"
 * and "I do not know what exists". They arrive at a call site looking almost
 * identical and mean opposite things to a crawler, so each degradation path gets
 * its own test rather than being folded into a general "handles errors" case.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { buildSiteSnapshot, type SnapshotBuild } from "./snapshot";
import { PublishedSite } from "./site";
import { parseTarget, parsePageParameter, canonicalRouteFor } from "./target";
import {
  FIXTURE_CLOUD_NAME,
  migratedDatabase,
  seedPublishedSite,
} from "./fixtures";
import { ContentRepository } from "../database/contentRepository";
import { PublicationRepository } from "../database/publicationRepository";

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

/** A site whose source can be swapped mid-test to simulate storage trouble. */
function controllableSite(db: Database): {
  site: PublishedSite;
  fail: (reason?: string) => void;
  recover: () => void;
} {
  let broken: string | null = null;

  const site = new PublishedSite((): SnapshotBuild => {
    if (broken !== null) throw new Error(broken);
    return buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME });
  });

  return {
    site,
    fail: (reason = "database is gone") => {
      broken = reason;
    },
    recover: () => {
      broken = null;
    },
  };
}

function readySite(db: Database): PublishedSite {
  const site = new PublishedSite(() =>
    buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME })
  );
  site.refresh();
  return site;
}

function url(path: string): URL {
  return new URL(path, "https://example.test");
}

function publishChangedAboutFixture(db: Database): void {
  const content = new ContentRepository(db);
  const about = content.findSingleton("about")!;
  const changed = content.update(
    about.id,
    {
      data: {
        ...(about.data as Record<string, unknown>),
        introMarkdown: "Changed published introduction.",
      },
    },
    "owner",
    new Date("2026-08-14T12:00:00.000Z")
  )!;
  new PublicationRepository(db).seedMigrationRevision(
    changed,
    new Date("2026-08-14T12:01:00.000Z")
  );
}

describe("resolving a target", () => {
  test("returns the page for each public route", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    for (const path of [
      "/",
      "/about",
      "/blog",
      "/projects",
      "/blog/first-post",
      "/projects/questurian",
    ]) {
      const resolution = site.resolveUrl(url(path));
      expect(resolution?.outcome).toBe("found");
    }
  });

  test("carries the generation and an etag seed with the page", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    const resolution = site.resolveUrl(url("/about"));

    expect(resolution?.outcome).toBe("found");
    if (resolution?.outcome !== "found") return;
    expect(resolution.generation).toBe(site.state().generation!);
    expect(resolution.etagSeed).toContain(resolution.generation);
    expect(resolution.canonicalRoute).toBe("/about");
  });

  test("every representation of a page describes one generation", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    const generations = new Set(
      ["/", "/about", "/blog", "/projects", "/blog/first-post"].map((path) => {
        const resolution = site.resolveUrl(url(path));
        return resolution?.outcome === "found" ? resolution.generation : "none";
      })
    );

    expect(generations.size).toBe(1);
  });

  test("a missing slug is a not-found, and says which generation proved it", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    const resolution = site.resolveUrl(url("/blog/does-not-exist"));

    expect(resolution?.outcome).toBe("not-found");
    if (resolution?.outcome !== "not-found") return;
    expect(resolution.generation).toBe(site.state().generation!);
  });

  test("a collection page past the end is a not-found", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    expect(site.resolveUrl(url("/blog?page=99"))?.outcome).toBe("not-found");
  });

  test("page one of an empty collection still exists", () => {
    const db = database();
    seedPublishedSite(db, { blogPosts: [] });
    const site = readySite(db);

    // It is in the sitemap and the nav. 404ing it would break a promised link.
    expect(site.resolveUrl(url("/blog"))?.outcome).toBe("found");
  });

  test("routes this module does not own are not its to answer", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    // A 404 here would let a routing mistake read as missing content.
    expect(site.resolveUrl(url("/healthz"))).toBeNull();
    expect(site.resolveUrl(url("/admin"))).toBeNull();
  });
});

describe("redirects", () => {
  test("a moved route answers with its current address before any lookup", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    const resolution = site.resolveUrl(url("/home"));

    expect(resolution?.outcome).toBe("redirect");
    if (resolution?.outcome !== "redirect") return;
    expect(resolution.location).toBe("/");
  });

  test("a redirect is answered even with no generation loaded", () => {
    const db = database();
    const site = new PublishedSite(() =>
      buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME })
    );

    // The target of `/home` does not depend on content, so storage trouble is
    // no reason to stop honouring it.
    expect(site.resolveUrl(url("/home"))?.outcome).toBe("redirect");
  });
});

describe("degradation", () => {
  test("a cold start with no generation is unavailable, never a 404", () => {
    const db = database();
    seedPublishedSite(db);
    const { site, fail } = controllableSite(db);

    fail();
    site.refresh();

    expect(site.resolveUrl(url("/"))?.outcome).toBe("unavailable");
    // The specific trap #34 names: an unknown route with no snapshot.
    expect(site.resolveUrl(url("/blog/anything"))?.outcome).toBe("unavailable");
    expect(site.state().status).toBe("unavailable");
  });

  test("a warm process keeps serving after storage goes away", () => {
    const db = database();
    seedPublishedSite(db);
    const { site, fail } = controllableSite(db);

    site.refresh();
    const generation = site.state().generation!;

    fail();
    site.refresh();

    const resolution = site.resolveUrl(url("/"));
    expect(resolution?.outcome).toBe("found");
    if (resolution?.outcome !== "found") return;
    expect(resolution.generation).toBe(generation);
    expect(site.state().status).toBe("degraded");
  });

  test("an invalid candidate cannot poison the active generation", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);
    const generation = site.state().generation;

    // Losing a current immutable pointer must reject the candidate rather than
    // falling back to the private draft row.
    db.query(
      "UPDATE content_items SET current_published_revision_id = NULL WHERE id = ?"
    ).run("singleton:home");

    const outcome = site.refresh();

    expect(outcome.status).toBe("rejected");
    expect(site.state().generation).toBe(generation);
    expect(site.resolveUrl(url("/"))?.outcome).toBe("found");
  });

  test("recovering re-activates and clears the degraded status", () => {
    const db = database();
    seedPublishedSite(db);
    const { site, fail, recover } = controllableSite(db);

    site.refresh();
    fail();
    site.refresh();
    expect(site.state().status).toBe("degraded");

    recover();
    site.refresh();

    expect(site.state().status).toBe("ready");
  });

  test("a failure is reported without being able to serve it", () => {
    const db = database();
    seedPublishedSite(db);
    const { site, fail } = controllableSite(db);

    fail("volume not mounted");
    site.refresh();

    const state = site.state();
    expect(state.rejections).toBe(1);
    expect(state.lastFailure?.findings.map((f) => f.code)).toContain(
      "snapshot_source_failed"
    );
    expect(state.lastFailure?.detail).toBe("volume not mounted");
  });

  // `/readyz` is unauthenticated and publishes every finding's code, so a
  // driver's error text — which can name the database file or quote a
  // statement — must never reach one. It belongs to `detail`, which nothing
  // serves.
  test("the underlying error text never reaches a finding code", () => {
    const db = database();
    seedPublishedSite(db);
    const { site, fail } = controllableSite(db);

    fail(
      "SQLITE_CANTOPEN: unable to open database file /data/portfolio.sqlite"
    );
    site.refresh();

    const codes = site.state().lastFailure?.findings.map((f) => f.code) ?? [];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe("activation", () => {
  test("an unchanged generation is not re-activated", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    const outcome = site.refresh();

    // Re-pointing at identical content would invalidate every ETag for nothing.
    expect(outcome.status).toBe("unchanged");
    expect(site.state().activations).toBe(1);
  });

  test("changed content activates a new generation", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);
    const before = site.state().generation;

    publishChangedAboutFixture(db);

    expect(site.refresh().status).toBe("activated");
    expect(site.state().generation).not.toBe(before);
  });

  test("the whole site moves to the new generation at once", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);
    const before = site.state().generation;

    publishChangedAboutFixture(db);
    site.refresh();

    const generations = ["/", "/about", "/blog", "/projects"].map((path) => {
      const resolution = site.resolveUrl(url(path));
      return resolution?.outcome === "found" ? resolution.generation : "none";
    });

    expect(new Set(generations).size).toBe(1);
    expect(generations[0]).not.toBe(before);
  });
});

describe("discovery", () => {
  test("returns the canonical routes of the active generation", () => {
    const db = database();
    seedPublishedSite(db);
    const site = readySite(db);

    const manifest = site.discovery();

    expect(manifest?.generation).toBe(site.state().generation!);
    expect(manifest?.routes).toContain("/projects/questurian");
  });

  test("returns nothing rather than an empty manifest when unavailable", () => {
    const db = database();
    const { site, fail } = controllableSite(db);

    fail();
    site.refresh();

    // An empty sitemap tells search engines every published URL is gone.
    expect(site.discovery()).toBeNull();
  });

  test("every discovered route resolves", () => {
    const db = database();
    seedPublishedSite(db, {
      blogPosts: Array.from({ length: 5 }, (_, index) => ({
        slug: `post-${index}`,
        date: `2026-01-0${index + 1}`,
      })),
    });
    const site = readySite(db);

    for (const route of site.discovery()!.routes) {
      expect(site.resolveUrl(url(route))?.outcome).toBe("found");
    }
  });
});

describe("parsing an address", () => {
  test("absent page means page one; a bad page is not coerced to one", () => {
    expect(parsePageParameter(null)).toBe(1);
    expect(parsePageParameter("2")).toBe(2);
    expect(parsePageParameter("0")).toBeNull();
    expect(parsePageParameter("-1")).toBeNull();
    expect(parsePageParameter("1.5")).toBeNull();
    expect(parsePageParameter("two")).toBeNull();
  });

  test("an encoded path separator cannot smuggle a different route", () => {
    expect(
      parseTarget(url("/projects/%2e%2e%2fprojects%2fminimal-portfolio"))
    ).toBeNull();
  });

  test("a slug outside the public shape is refused", () => {
    expect(parseTarget(url("/blog/Not_A_Slug"))).toBeNull();
    expect(parseTarget(url("/blog/trailing-"))).toBeNull();
  });

  test("canonical routes round-trip through parsing", () => {
    for (const path of [
      "/",
      "/about",
      "/blog",
      "/blog?page=3",
      "/projects",
      "/projects?page=2",
      "/blog/a-post",
      "/projects/a-project",
    ]) {
      const target = parseTarget(url(path));
      expect(target).not.toBeNull();
      expect(canonicalRouteFor(target!)).toBe(path);
    }
  });
});
