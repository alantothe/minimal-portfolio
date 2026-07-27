import { describe, expect, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";
import { GitHubCommitCounter } from "./services/github";
import { gunzipSync } from "node:zlib";

function createRequestHandler() {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

describe("production response performance", () => {
  test("static assets are cacheable and support conditional requests", async () => {
    const handler = createRequestHandler();
    const first = await handler.handleRequest(
      new Request("http://portfolio.test/public/css/global.css"),
    );
    const etag = first.headers.get("ETag");
    const second = await handler.handleRequest(
      new Request("http://portfolio.test/public/css/global.css", {
        headers: { "If-None-Match": etag! },
      }),
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toContain("public");
    expect(etag).not.toBeNull();
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("HTML stays revalidatable and reserves profile image space", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/about"),
    );
    const homeResponse = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/"),
    );
    const home = await homeResponse.text();

    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(home).toContain('src="/avatar.webp"');
    expect(home).toContain('width="512"');
    expect(home).toContain('height="510"');
  });

  test("SSR loads only the current route stylesheet", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/projects"),
    );
    const html = await response.text();

    expect(html).toContain(
      '<link id="page-css" rel="stylesheet" href="/pages/projects/styles.css">',
    );
    expect(html).not.toContain('/pages/home/styles.css');
    expect(html).not.toContain('/pages/about/styles.css');
    expect(html).not.toContain('/pages/blog/styles.css');
  });

  test("compresses text responses when the client accepts gzip", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", {
        headers: { "Accept-Encoding": "gzip" },
      }),
    );

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");

    const decompressed = gunzipSync(
      new Uint8Array(await response.arrayBuffer()),
    );
    expect(new TextDecoder().decode(decompressed)).toContain("<!DOCTYPE html>");
  });
});

describe("GitHub commit metric", () => {
  test("coalesces concurrent requests and reuses a fresh memory cache", async () => {
    let fetchCalls = 0;
    const counter = new GitHubCommitCounter({
      now: () => new Date("2026-07-27T12:00:00Z"),
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({ total_count: 263 });
      },
    });

    const counts = await Promise.all([
      counter.getMonthlyCommitCount("token", "alantothe"),
      counter.getMonthlyCommitCount("token", "alantothe"),
    ]);
    const cached = await counter.getMonthlyCommitCount("token", "alantothe");

    expect(counts).toEqual([263, 263]);
    expect(cached).toBe(263);
    expect(fetchCalls).toBe(1);
  });

  test("returns zero without credentials and does not call GitHub", async () => {
    let fetchCalls = 0;
    const counter = new GitHubCommitCounter({
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({ total_count: 1 });
      },
    });

    expect(await counter.getMonthlyCommitCount()).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  test("backs off after an outage while serving stale data", async () => {
    let now = new Date("2026-07-27T12:00:00Z");
    let fetchCalls = 0;
    const counter = new GitHubCommitCounter({
      now: () => now,
      ttlMs: 1_000,
      failureTtlMs: 30_000,
      fetch: async () => {
        fetchCalls += 1;
        if (fetchCalls > 1) {
          return new Response(null, { status: 503 });
        }
        return Response.json({ total_count: 263 });
      },
    });

    expect(await counter.getMonthlyCommitCount("token", "alantothe")).toBe(263);
    now = new Date(now.getTime() + 2_000);
    expect(await counter.getMonthlyCommitCount("token", "alantothe")).toBe(263);
    expect(await counter.getMonthlyCommitCount("token", "alantothe")).toBe(263);
    expect(fetchCalls).toBe(2);
  });
});
