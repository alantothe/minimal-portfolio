/**
 * What the published renderer puts on the page.
 *
 * The parity run already proves the whole document matches the frozen contract,
 * so these tests deliberately do not re-assert that. They cover the pieces the
 * parity run cannot explain on its own: the system-owned behaviour hooks, which
 * exist precisely because content is forbidden from carrying them, and the two
 * places where the renderer has to *add* something the content model removed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { buildSiteSnapshot, type SiteSnapshot } from "./snapshot";
import { PublishedSite } from "./site";
import { renderPublishedPage, blogPostBody } from "./render";
import { publishedBlogPostPayload } from "./representations";
import { toInlineHtml, unwrapSingleParagraph } from "./inlineCopy";
import { publishedSeoMetadata } from "./seo";
import { FIXTURE_CLOUD_NAME, migratedDatabase, seedSite } from "./fixtures";
import type { FoundPage } from "./target";

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

function siteFor(db: Database): {
  site: PublishedSite;
  snapshot: SiteSnapshot;
} {
  const site = new PublishedSite(() =>
    buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME })
  );
  site.refresh();
  return { site, snapshot: site.snapshot()! };
}

function found(site: PublishedSite, path: string): FoundPage {
  const resolution = site.resolveUrl(new URL(path, "https://example.test"));
  if (resolution?.outcome !== "found") {
    throw new Error(`${path} did not resolve to a page`);
  }
  return resolution;
}

describe("system-owned behaviour hooks", () => {
  test("a single rendered paragraph is unwrapped for its template", () => {
    // The template supplies `<p class="intro">`, so a bare `<p>` inside it
    // would nest one paragraph in another.
    expect(unwrapSingleParagraph("<p>Hello</p>")).toBe("Hello");
  });

  test("several paragraphs are left alone", () => {
    const html = "<p>One</p><p>Two</p>";

    expect(unwrapSingleParagraph(html)).toBe(html);
  });

  test("an internal link gets the SPA hook back", () => {
    const html = toInlineHtml(
      '<p>See my <a href="/projects">projects</a>.</p>'
    );

    expect(html).toContain('class="home-inline-link"');
    expect(html).toContain("data-spa-link");
  });

  test("an external link keeps its security attributes and gains no hook", () => {
    const html = toInlineHtml(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">out</a></p>'
    );

    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("data-spa-link");
  });

  test("a mailto link becomes the click-to-copy control", () => {
    const html = toInlineHtml('<p><a href="mailto:a@b.test">reach out</a></p>');

    expect(html).toBe(
      '<span id="copy-email" data-email="a@b.test">reach out</span>'
    );
  });

  test("a second mailto link stays a mail link", () => {
    // The id is a document-unique hook. Emitting it twice would be invalid HTML
    // and a control that copies the wrong address.
    const html = toInlineHtml(
      '<p><a href="mailto:a@b.test">first</a> and <a href="mailto:c@d.test">second</a></p>'
    );

    expect(html.match(/id="copy-email"/g)).toHaveLength(1);
    expect(html).toContain('href="mailto:c@d.test"');
  });

  test("content cannot supply the hooks itself", () => {
    const db = database();
    // Markdown carrying raw HTML is dropped by the restricted renderer, so an
    // Owner cannot hand-write a data attribute into their bio.
    seedSite(db, {
      homeBio:
        'Contact <span id="copy-email" data-email="evil@test">me</span>.',
    });

    const build = buildSiteSnapshot(db, { cloudName: FIXTURE_CLOUD_NAME });

    // Raw HTML in a short field is a blocking finding, so no generation builds.
    expect(build.status).toBe("invalid");
  });
});

describe("what the renderer restores", () => {
  test("a blog post gets its heading back", () => {
    const db = database();
    seedSite(db);
    const { snapshot } = siteFor(db);

    const html = blogPostBody(snapshot.blogPosts[0]!);

    // The importer stripped the duplicate H1 from the body; the template owns it
    // now, so the page still has exactly one.
    expect(html).toContain("<h1>Post first-post</h1>");
  });

  test("the SSR page and the JSON payload carry the same body", async () => {
    const db = database();
    seedSite(db);
    const { site, snapshot } = siteFor(db);
    const page = found(site, "/blog/first-post");

    const rendered = await renderPublishedPage(page.view, snapshot);
    const payload = await publishedBlogPostPayload(
      page,
      snapshot,
      new URL("https://example.test/blog/first-post")
    );

    // They disagreed once — the SSR page had the heading and the payload did
    // not — which is what a shared helper prevents.
    expect(rendered.content).toContain(payload.html as string);
  });

  test("the portrait is sized to what is actually delivered", async () => {
    const db = database();
    seedSite(db);
    const { site, snapshot } = siteFor(db);

    const rendered = await renderPublishedPage(found(site, "/").view, snapshot);

    // The template hard-codes the legacy 512x510; the avatar variant fills 800.
    expect(rendered.content).toContain('width="800"');
    expect(rendered.content).not.toContain('width="512"');
  });

  test("a blog post's published time is an instant, not a calendar date", () => {
    const db = database();
    seedSite(db);
    const { site, snapshot } = siteFor(db);

    const seo = publishedSeoMetadata(
      found(site, "/blog/first-post"),
      snapshot,
      new URL("https://example.test/blog/first-post")
    );

    expect(seo.publishedTime).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("optional enrichment", () => {
  test("a page renders completely with nothing gathered", async () => {
    const db = database();
    seedSite(db);
    const { site, snapshot } = siteFor(db);

    const rendered = await renderPublishedPage(found(site, "/").view, snapshot);

    expect(rendered.content).toContain("Ada Lovelace");
    expect(rendered.content).toContain("Founding Engineer at Example");
  });

  test("collection pages render their own page's items only", async () => {
    const db = database();
    seedSite(db, {
      blogPosts: Array.from({ length: 5 }, (_, index) => ({
        slug: `post-${index}`,
        date: `2026-01-0${index + 1}`,
      })),
    });
    const { site, snapshot } = siteFor(db);

    const first = await renderPublishedPage(
      found(site, "/blog").view,
      snapshot
    );
    const second = await renderPublishedPage(
      found(site, "/blog?page=2").view,
      snapshot
    );

    // Four per page, so the fifth post appears only on page two.
    expect(first.content).toContain("post-4");
    expect(first.content).not.toContain("post-0");
    expect(second.content).toContain("post-0");
  });

  test("pagination marks the page being viewed", async () => {
    const db = database();
    seedSite(db, {
      blogPosts: Array.from({ length: 5 }, (_, index) => ({
        slug: `post-${index}`,
        date: `2026-01-0${index + 1}`,
      })),
    });
    const { site, snapshot } = siteFor(db);

    const second = await renderPublishedPage(
      found(site, "/blog?page=2").view,
      snapshot
    );

    expect(second.content).toContain('aria-current="page"');
  });
});
