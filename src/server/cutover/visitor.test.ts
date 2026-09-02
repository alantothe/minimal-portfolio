/**
 * Visitor reads from the published generation once cutover leaves `legacy`.
 *
 * The fixture Home is "Ada Lovelace". Repository Home is not. If this name
 * appears on a public route, the published generation is what was served.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { buildSiteSnapshot } from "../published/snapshot";
import { PublishedSite } from "../published/site";
import {
  FIXTURE_CLOUD_NAME,
  migratedDatabase,
  seedPublishedSite,
} from "../published/fixtures";
import { NO_ENRICHMENT } from "../published/render";
import { servePublishedVisitor } from "./visitor";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

function fixtureSite(): PublishedSite {
  const { database, directory } = migratedDatabase();
  directories.push(directory);
  seedPublishedSite(database);
  const site = new PublishedSite(() =>
    buildSiteSnapshot(database, { cloudName: FIXTURE_CLOUD_NAME })
  );
  site.refresh();
  return site;
}

describe("published Visitor responses", () => {
  test("serves the published Home document with a generation ETag", async () => {
    const site = fixtureSite();
    const request = new Request("https://example.test/");
    const response = await servePublishedVisitor(request, site, NO_ENRICHMENT);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toContain("Ada Lovelace");
    expect(response!.headers.get("ETag")).toBeTruthy();
    expect(response!.headers.get("Cache-Control")).toBe("no-cache");
    expect(response!.headers.get("Content-Type")).toContain("text/html");
  });

  test("answers a matching If-None-Match with 304", async () => {
    const site = fixtureSite();
    const first = await servePublishedVisitor(
      new Request("https://example.test/"),
      site,
      NO_ENRICHMENT
    );
    const etag = first!.headers.get("ETag");
    const second = await servePublishedVisitor(
      new Request("https://example.test/", {
        headers: { "If-None-Match": etag! },
      }),
      site,
      NO_ENRICHMENT
    );

    expect(second!.status).toBe(304);
    expect(await second!.text()).toBe("");
  });

  test("changes the ETag when live enrichment changes within one generation", async () => {
    const site = fixtureSite();
    const first = await servePublishedVisitor(
      new Request("https://example.test/"),
      site,
      { ...NO_ENRICHMENT, githubCommits: 468 }
    );
    const etag = first!.headers.get("ETag");
    const current = await servePublishedVisitor(
      new Request("https://example.test/", {
        headers: { "If-None-Match": etag! },
      }),
      site,
      { ...NO_ENRICHMENT, githubCommits: 572 }
    );

    expect(current!.status).toBe(200);
    expect(current!.headers.get("ETag")).not.toBe(etag);
    expect(await current!.text()).toContain("572 commits this month");
  });

  test("leaves liveness and Owner routes to the existing router", async () => {
    const site = fixtureSite();

    expect(
      await servePublishedVisitor(
        new Request("https://example.test/healthz"),
        site,
        NO_ENRICHMENT
      )
    ).toBeNull();
    expect(
      await servePublishedVisitor(
        new Request("https://example.test/admin"),
        site,
        NO_ENRICHMENT
      )
    ).toBeNull();
  });

  test("redirects /home to the canonical Home route", async () => {
    const site = fixtureSite();
    const response = await servePublishedVisitor(
      new Request("https://example.test/home"),
      site,
      NO_ENRICHMENT
    );

    expect(response!.status).toBe(308);
    expect(response!.headers.get("Location")).toBe("/");
  });
});
