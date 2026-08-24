import { describe, expect, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";
import {
  GitHubCommitCounter,
  GitHubContributionCalendar,
} from "./services/github";
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
      new Request("http://portfolio.test/public/css/global.css")
    );
    const etag = first.headers.get("ETag");
    const second = await handler.handleRequest(
      new Request("http://portfolio.test/public/css/global.css", {
        headers: { "If-None-Match": etag! },
      })
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toContain("public");
    expect(etag).not.toBeNull();
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  test("HTML stays revalidatable and reserves profile image space", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/about")
    );
    const homeResponse = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/")
    );
    const home = await homeResponse.text();

    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(home).toContain('src="/avatar.webp"');
    expect(home).toContain('width="512"');
    expect(home).toContain('height="510"');
    expect(home).toContain("/pages/home/styles.css?v=commits-panel");
  });

  test("SSR loads only the current route stylesheet", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/projects")
    );
    const html = await response.text();

    expect(html).toContain(
      '<link id="page-css" rel="stylesheet" href="/pages/projects/styles.css?v=mobile-no-hover">'
    );
    expect(html).not.toContain("/pages/home/styles.css");
    expect(html).not.toContain("/pages/about/styles.css");
    expect(html).not.toContain("/pages/blog/styles.css");
  });

  test("compresses text responses when the client accepts gzip", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", {
        headers: { "Accept-Encoding": "gzip" },
      })
    );

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");

    const decompressed = gunzipSync(
      new Uint8Array(await response.arrayBuffer())
    );
    expect(new TextDecoder().decode(decompressed)).toMatch(/^<!doctype html>/i);
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

describe("GitHub contribution calendar", () => {
  test("coalesces requests and returns daily activity for the past year", async () => {
    let fetchCalls = 0;
    const calendar = new GitHubContributionCalendar({
      now: () => new Date("2026-07-29T12:00:00Z"),
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({
          data: {
            user: {
              contributionsCollection: {
                totalCommitContributions: 512,
                contributionCalendar: {
                  totalContributions: 621,
                  weeks: [
                    {
                      contributionDays: [
                        {
                          contributionCount: 0,
                          contributionLevel: "NONE",
                          date: "2026-07-27",
                          weekday: 1,
                        },
                        {
                          contributionCount: 7,
                          contributionLevel: "FOURTH_QUARTILE",
                          date: "2026-07-28",
                          weekday: 2,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        });
      },
    });

    const [first, concurrent] = await Promise.all([
      calendar.getYearlyActivity("token", "alantothe"),
      calendar.getYearlyActivity("token", "alantothe"),
    ]);
    const cached = await calendar.getYearlyActivity("token", "alantothe");

    expect(first).toEqual({
      totalContributions: 621,
      totalCommitContributions: 512,
      weeks: [
        [
          {
            count: 0,
            date: "2026-07-27",
            level: "NONE",
            weekday: 1,
          },
          {
            count: 7,
            date: "2026-07-28",
            level: "FOURTH_QUARTILE",
            weekday: 2,
          },
        ],
      ],
    });
    expect(concurrent).toEqual(first);
    expect(cached).toEqual(first);
    expect(fetchCalls).toBe(1);
  });

  test("returns null without credentials and does not call GitHub", async () => {
    let fetchCalls = 0;
    const calendar = new GitHubContributionCalendar({
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    });

    expect(await calendar.getYearlyActivity()).toBeNull();
    expect(fetchCalls).toBe(0);
  });
});
