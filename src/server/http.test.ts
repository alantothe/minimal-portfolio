import { describe, expect, spyOn, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";
import { createShellHandler } from "./handlers/shell";

function createRequestHandler() {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

function extractDetailLinks(html: string, collection: "blog" | "projects") {
  const pattern = new RegExp(`href="/${collection}/([^"?]+)"`, "g");
  return Array.from(html.matchAll(pattern), (match) => match[1]);
}

describe("public HTTP behavior", () => {
  test.each([
    "/blog/does-not-exist",
    "/projects/does-not-exist",
    "/projects/%2e%2e%2fprojects%2fminimal-portfolio",
  ])("%s returns a real 404", async (path) => {
    const response = await createRequestHandler().handleRequest(
      new Request(`http://portfolio.test${path}`)
    );

    expect(response.status).toBe(404);
  });

  test("unexpected SSR failures return 500 instead of an empty indexable page", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await createShellHandler(
        new URL("http://portfolio.test/projects"),
        undefined,
        {
          loadPageContent: async () => {
            throw new Error("render failed");
          },
        }
      )();

      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      errorLog.mockRestore();
    }
  });

  test("unsupported methods return 405 with allowed methods", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", { method: "POST" })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });

  test("OPTIONS advertises supported methods without a body", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", { method: "OPTIONS" })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(await response.text()).toBe("");
  });

  test("health check reports liveness", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/healthz")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("unused bulk page endpoint is not exposed", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/api/pages")
    );

    expect(response.status).toBe(404);
  });

  test("blog listing is fully rendered with crawlable post links", async () => {
    const handler = createRequestHandler();
    const listing = await handler.handleRequest(
      new Request("http://portfolio.test/blog")
    );
    const listApi = await handler.handleRequest(
      new Request("http://portfolio.test/api/blog/list")
    );
    const html = await listing.text();
    const { posts } = await listApi.json();

    expect(listing.status).toBe(200);
    expect(html).not.toContain("Loading posts...");
    expect(extractDetailLinks(html, "blog").sort()).toEqual(
      posts.map((post: { slug: string }) => post.slug).sort()
    );
  });

  test("project listing exposes every selected project through anchors", async () => {
    const handler = createRequestHandler();
    const firstPage = await handler.handleRequest(
      new Request("http://portfolio.test/projects")
    );
    const listApi = await handler.handleRequest(
      new Request("http://portfolio.test/api/projects/list")
    );
    const firstHtml = await firstPage.text();
    const { projects } = await listApi.json();
    const discovered = extractDetailLinks(firstHtml, "projects");

    expect(firstHtml).not.toContain("Loading projects...");
    expect(firstHtml).toContain('class="project-image"');
    expect(firstHtml).toContain('class="project-card__arrow"');
    expect(firstHtml).toContain('class="project-arrow-ring-progress"');
    expect(firstHtml).not.toContain('href="/projects?page=2"');
    expect(projects.map((project: { slug: string }) => project.slug)).toEqual([
      "questurian",
      "minimal-portfolio",
    ]);
    expect(discovered.sort()).toEqual(
      projects.map((project: { slug: string }) => project.slug).sort()
    );
  });

  test("out-of-range collection pages return 404", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/projects?page=99")
    );

    expect(response.status).toBe(404);
  });

  test("page fragment API renders requested collection page", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/api/page?name=projects")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.content).toContain('href="/projects/questurian"');
    expect(data.content).toContain('href="/projects/minimal-portfolio"');
  });

  test("home exposes GitHub activity through an interactive popover", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/")
    );
    const html = await response.text();

    expect(html).toContain('<div class="github-activity">');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("data-github-activity-trigger");
    expect(html).toContain("commits this month");
    expect(html).toContain('class="github-activity__profile-link"');
    expect(html).toContain('class="github-activity__external-icon"');
    expect(html).toMatch(
      /class="github-activity__external-icon"[\s\S]*?width="16"[\s\S]*?height="16"/
    );
    expect(html).toContain('href="https://github.com/alantothe"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(
      '<a class="stat-item stat-link" href="/blog" data-spa-link>'
    );
    expect(html).toContain(
      '<a class="home-inline-link" href="/projects" data-spa-link>projects</a>'
    );
    expect(html).toContain('<div class="stat-item stat-highlight">');
    expect(html).toContain('id="github-activity-panel"');
  });
});
