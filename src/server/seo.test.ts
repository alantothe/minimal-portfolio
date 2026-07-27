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

function getAttribute(html: string, selector: RegExp): string | null {
  return html.match(selector)?.[1] ?? null;
}

function getStructuredData(html: string) {
  return Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    match => JSON.parse(match[1]!),
  );
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

describe("search metadata", () => {
  test.each([
    ["/", "Alan Malpartida"],
    ["/about", "About Alan Malpartida"],
    ["/blog", "Alan Malpartida"],
    ["/projects", "Alan Malpartida"],
    ["/blog/who-is-alan-malpartida-software-engineer-and-founder", "Who Is Alan Malpartida"],
    ["/projects/minimal-blog", "Minimal Blog Platform"],
  ])("%s has unique metadata and social tags", async (path, titleText) => {
    const response = await createRequestHandler().handleRequest(
      new Request(`http://portfolio.test${path}`),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(getAttribute(html, /<title>([^<]+)<\/title>/)).toContain(titleText);
    expect(getAttribute(
      html,
      /<meta name="description" content="([^"]+)">/,
    )).not.toBeEmpty();
    expect(getAttribute(
      html,
      /<link rel="canonical" href="([^"]+)">/,
    )).toBe(`https://alan.example${path}`);
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('<meta property="og:description"');
    expect(html).toContain('<meta property="og:url"');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  test("pagination keeps its page in the canonical URL", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/projects?page=2"),
    );
    const html = await response.text();

    expect(getAttribute(
      html,
      /<link rel="canonical" href="([^"]+)">/,
    )).toBe("https://alan.example/projects?page=2");
  });

  test("/home permanently redirects to the canonical home URL", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/home"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/");
  });

  test.each([
    ["/", "Person"],
    ["/about", "ProfilePage"],
    ["/blog/who-is-alan-malpartida-software-engineer-and-founder", "BlogPosting"],
  ])("%s emits valid %s structured data", async (path, schemaType) => {
    const response = await createRequestHandler().handleRequest(
      new Request(`http://portfolio.test${path}`),
    );
    const schemas = getStructuredData(await response.text());

    expect(schemas.some(schema => schema["@type"] === schemaType)).toBeTrue();
  });

  test("fragment responses include metadata for SPA navigation", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/api/page?name=about"),
    );
    const data = await response.json();

    expect(data.seo.title).toBe("About Alan Malpartida");
    expect(data.seo.canonical).toBe("https://alan.example/about");
  });
});
