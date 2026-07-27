import { describe, expect, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";

function createRequestHandler() {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

function extractDetailLinks(html: string, collection: "blog" | "projects") {
  const pattern = new RegExp(`href="/${collection}/([^"?]+)"`, "g");
  return Array.from(html.matchAll(pattern), match => match[1]);
}

describe("public HTTP behavior", () => {
  test.each([
    "/blog/does-not-exist",
    "/projects/does-not-exist",
  ])("%s returns a real 404", async (path) => {
    const response = await createRequestHandler().handleRequest(
      new Request(`http://portfolio.test${path}`),
    );

    expect(response.status).toBe(404);
  });

  test("unsupported methods return 405 with allowed methods", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });

  test("OPTIONS advertises supported methods without a body", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(await response.text()).toBe("");
  });

  test("health check reports readiness", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/healthz"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("unused bulk page endpoint is not exposed", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/api/pages"),
    );

    expect(response.status).toBe(404);
  });

  test("blog listing is fully rendered with crawlable post links", async () => {
    const handler = createRequestHandler();
    const listing = await handler.handleRequest(
      new Request("http://portfolio.test/blog"),
    );
    const listApi = await handler.handleRequest(
      new Request("http://portfolio.test/api/blog/list"),
    );
    const html = await listing.text();
    const { posts } = await listApi.json();

    expect(listing.status).toBe(200);
    expect(html).not.toContain("Loading posts...");
    expect(extractDetailLinks(html, "blog").sort()).toEqual(
      posts.map((post: { slug: string }) => post.slug).sort(),
    );
  });

  test("project pagination exposes every project through anchors", async () => {
    const handler = createRequestHandler();
    const firstPage = await handler.handleRequest(
      new Request("http://portfolio.test/projects"),
    );
    const secondPage = await handler.handleRequest(
      new Request("http://portfolio.test/projects?page=2"),
    );
    const listApi = await handler.handleRequest(
      new Request("http://portfolio.test/api/projects/list"),
    );
    const firstHtml = await firstPage.text();
    const secondHtml = await secondPage.text();
    const { projects } = await listApi.json();
    const discovered = [
      ...extractDetailLinks(firstHtml, "projects"),
      ...extractDetailLinks(secondHtml, "projects"),
    ];

    expect(firstHtml).not.toContain("Loading projects...");
    expect(firstHtml).toContain('href="/projects?page=2"');
    expect(discovered.sort()).toEqual(
      projects.map((project: { slug: string }) => project.slug).sort(),
    );
  });

  test("out-of-range collection pages return 404", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/projects?page=99"),
    );

    expect(response.status).toBe(404);
  });

  test("page fragment API renders requested collection page", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/api/page?name=projects&page=2"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.content).toContain('href="/projects/le-vino"');
  });
});
