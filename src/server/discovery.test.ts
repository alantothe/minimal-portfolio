import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";

const previousSiteUrl = process.env.SITE_URL;

function createRequestHandler() {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

beforeAll(() => {
  process.env.SITE_URL = "https://alan.example";
});

afterAll(() => {
  if (previousSiteUrl === undefined) {
    delete process.env.SITE_URL;
  } else {
    process.env.SITE_URL = previousSiteUrl;
  }
});

describe("search discovery", () => {
  test("sitemap contains every canonical content URL", async () => {
    const handler = createRequestHandler();
    const sitemapResponse = await handler.handleRequest(
      new Request("http://portfolio.test/sitemap.xml"),
    );
    const blogResponse = await handler.handleRequest(
      new Request("http://portfolio.test/api/blog/list"),
    );
    const projectResponse = await handler.handleRequest(
      new Request("http://portfolio.test/api/projects/list"),
    );
    const sitemap = await sitemapResponse.text();
    const { posts } = await blogResponse.json();
    const { projects } = await projectResponse.json();
    const urls = Array.from(
      sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
      match => match[1]!,
    );

    expect(sitemapResponse.status).toBe(200);
    expect(sitemapResponse.headers.get("Content-Type")).toContain("application/xml");
    expect(urls).toContain("https://alan.example/");
    expect(urls).toContain("https://alan.example/about");
    expect(urls).toContain("https://alan.example/blog");
    expect(urls).toContain("https://alan.example/projects");
    expect(urls).toContain("https://alan.example/projects?page=2");
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some(url => url.includes("/api/"))).toBeFalse();
    expect(urls).not.toContain("https://alan.example/home");

    for (const post of posts) {
      expect(urls).toContain(`https://alan.example/blog/${post.slug}`);
    }
    for (const project of projects) {
      expect(urls).toContain(`https://alan.example/projects/${project.slug}`);
    }
  });

  test("robots file allows crawling and advertises sitemap", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/robots.txt"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://alan.example/sitemap.xml");
  });
});
