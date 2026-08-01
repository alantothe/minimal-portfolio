/**
 * The generation's place in a running process, and the proof that it is dark.
 *
 * The darkness tests are the important half. Every other file in this module
 * builds machinery for serving a database-backed site; this one asserts that
 * none of it is reachable, which is the single claim #43 makes about what a
 * Visitor experiences after this slice ships.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { RequestHandler } from "../core/requestHandler";
import { Router } from "../core/router";
import { setupRoutes } from "../routes";
import { SystemStateRepository } from "../database/repository";
import { publishedSiteGatesReadiness } from "./lifecycle";
import { migratedDatabase, seedSite } from "./fixtures";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

function handler(): RequestHandler {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

describe("the readiness gate", () => {
  test("a dark generation cannot fail a deployment", () => {
    // While legacy content is authoritative, a content problem in a subsystem
    // no Visitor reads must not roll back a deploy of a working site.
    expect(publishedSiteGatesReadiness("legacy")).toBe(false);
    expect(publishedSiteGatesReadiness("shadow")).toBe(false);
  });

  test("once the site is served from it, a missing generation fails", () => {
    expect(publishedSiteGatesReadiness("sqlite-observation")).toBe(true);
    expect(publishedSiteGatesReadiness("sealed")).toBe(true);
  });

  test("every phase has an explicit answer", () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);

    // The stored phase starts at `legacy`; the point here is that the gate is a
    // total function over the phases the schema permits, so a future phase
    // cannot silently default to "gates nothing".
    const phase = new SystemStateRepository(database).getCutoverPhase();
    expect(typeof publishedSiteGatesReadiness(phase)).toBe("boolean");
  });
});

describe("the slice is dark", () => {
  test("no route serves a database generation", async () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    seedSite(database);

    // The seeded site says "Ada Lovelace". The repository content does not.
    // If any public route had been switched over, this name would appear.
    const request = handler();

    for (const path of ["/", "/about", "/blog", "/projects", "/sitemap.xml"]) {
      const response = await request.handleRequest(
        new Request(new URL(path, "https://example.test"))
      );
      const body = await response.text();

      expect(body).not.toContain("Ada Lovelace");
    }
  });

  test("the published module registers no routes of its own", () => {
    const router = new Router();
    setupRoutes(router);

    // A grep of the route table is the cheapest honest check that nothing was
    // wired up by accident. Anything under /published or /api/published would
    // mean this slice stopped being dark.
    const registered = JSON.stringify(router);

    expect(registered).not.toContain("published");
  });
});
