import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";
import { createSeoMetadata, renderSeoHead } from "./services/seo";
import { aboutConfig, homeConfig } from "../config";

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

  test("production metadata rejects an invalid configured origin", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousUrl = process.env.SITE_URL;

    try {
      process.env.NODE_ENV = "production";
      process.env.SITE_URL = "http://example.com";

      expect(() =>
        createSeoMetadata(
          { kind: "home" },
          new URL("http://attacker.example"),
        ),
      ).toThrow("SITE_URL");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previousUrl;
    }
  });

  test("uses portfolio config as the identity source of truth", () => {
    const previousAuthor = { ...homeConfig.author };
    const previousTitle = homeConfig.professional.title;
    const previousLinks = [...aboutConfig.sections.personal.socialLinks];

    try {
      homeConfig.author.name = "Example Engineer";
      homeConfig.author.photo = "https://cdn.example/profile.webp";
      homeConfig.professional.title = "Principal Engineer";
      aboutConfig.sections.personal.socialLinks = [
        { name: "GitHub", url: "https://github.com/example" },
      ];

      const metadata = createSeoMetadata(
        { kind: "home" },
        new URL("https://portfolio.test"),
      );
      const schema = metadata.structuredData as Record<string, unknown>;
      const head = renderSeoHead(metadata);

      expect(metadata.title).toContain("Example Engineer");
      expect(metadata.image).toBe("https://cdn.example/profile.webp");
      expect(schema.name).toBe("Example Engineer");
      expect(schema.jobTitle).toBe("Principal Engineer");
      expect(schema.sameAs).toEqual(["https://github.com/example"]);
      expect(head).toContain(
        '<meta property="og:site_name" content="Example Engineer">',
      );
    } finally {
      Object.assign(homeConfig.author, previousAuthor);
      homeConfig.professional.title = previousTitle;
      aboutConfig.sections.personal.socialLinks = previousLinks;
    }
  });
});
