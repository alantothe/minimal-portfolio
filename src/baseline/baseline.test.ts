import { describe, expect, test } from "bun:test";
import { RequestHandler } from "../server/core/requestHandler";
import { Router } from "../server/core/router";
import { setupRoutes } from "../server/routes";
import { captureGoldenContract } from "./capture";
import { withBaselineEnvironment } from "./environment";
import { compareGoldenContracts, formatDifferences } from "./compare";
import { readGoldenContract } from "./artifact";
import { BASELINE_ARTIFACT_PATH, BASELINE_ORIGIN } from "./contract";
import {
  extractHeadings,
  extractImages,
  extractInternalLinks,
  extractSeo,
  normalizeVisibleText,
  stableJsonHash,
} from "./normalize";
import { buildRouteManifest } from "./routeManifest";

describe("golden contract", () => {
  test("public behaviour still matches the committed baseline", async () => {
    const [expected, received] = await Promise.all([
      readGoldenContract(),
      captureGoldenContract(),
    ]);

    const differences = compareGoldenContracts(expected, received);

    expect(
      differences.length === 0 ? [] : formatDifferences(differences)
    ).toEqual([]);
  });

  test("a capture is reproducible on demand", async () => {
    const first = await captureGoldenContract();
    const second = await captureGoldenContract();

    expect(compareGoldenContracts(first, second)).toEqual([]);
  });

  test("the baseline pins an origin instead of the runner's own", async () => {
    const contract = await readGoldenContract();
    const canonicals = contract.routes
      .map((route) => route.seo?.canonical)
      .filter((canonical): canonical is string => Boolean(canonical));

    expect(canonicals.length).toBeGreaterThan(0);
    for (const canonical of canonicals) {
      expect(canonical.startsWith(BASELINE_ORIGIN)).toBe(true);
    }
  });

  test("the Home page is captured without live GitHub metrics", async () => {
    // With a real GITHUB_TOKEN in the environment the Home page embeds a
    // contribution heatmap built from today's API response — dated, networked,
    // and different tomorrow. The capture environment must neutralize it, or
    // every baseline becomes unreproducible the next day.
    const rendered = await withBaselineEnvironment(async () => {
      const router = new Router();
      setupRoutes(router);
      const response = await new RequestHandler(router).handleRequest(
        new Request(new URL("/", BASELINE_ORIGIN))
      );
      return response.text();
    });

    expect(rendered).not.toContain("github-activity__heatmap");
  });

  test("capturing does not mutate the Blog view store", async () => {
    const before = await Bun.file("src/data/blog-views.json").text();
    await captureGoldenContract();
    const after = await Bun.file("src/data/blog-views.json").text();

    expect(after).toBe(before);
  });
});

describe("route manifest", () => {
  test("covers every published Blog post and Project", async () => {
    const manifest = await buildRouteManifest();
    const paths = manifest.map((route) => route.path);

    expect(paths).toContain("/");
    expect(paths).toContain("/about");
    expect(paths).toContain("/blog");
    expect(paths).toContain("/projects");
    expect(paths).toContain("/robots.txt");
    expect(paths).toContain("/sitemap.xml");
    expect(manifest.some((route) => route.kind === "blog-post")).toBe(true);
    expect(manifest.some((route) => route.kind === "project")).toBe(true);
  });

  test("never asks the site to count a Blog view", async () => {
    const manifest = await buildRouteManifest();

    for (const route of manifest) {
      expect(route.path).not.toContain("view=1");
    }
  });

  test("the committed baseline covers the whole manifest", async () => {
    const [manifest, contract] = await Promise.all([
      buildRouteManifest(),
      readGoldenContract(),
    ]);

    expect(contract.routes.map((route) => route.path)).toEqual(
      manifest.map((route) => route.path)
    );
  });
});

describe("normalization", () => {
  test("visible text ignores markup, entities, and whitespace", () => {
    const text = normalizeVisibleText(
      "<div>  <p>Hello   &amp;\n welcome</p><script>ignored()</script></div>"
    );

    expect(text).toBe("Hello & welcome");
  });

  test("headings keep their level and document order", () => {
    const headings = extractHeadings(
      "<h1>Title</h1><h2>First <em>section</em></h2><h3></h3>"
    );

    expect(headings).toEqual(["h1:Title", "h2:First section"]);
  });

  test("internal links are deduplicated and external links excluded", () => {
    const links = extractInternalLinks(
      '<a href="/blog">Blog</a><a href="/blog">Again</a><a href="https://example.com">Out</a>'
    );

    expect(links).toEqual(["/blog"]);
  });

  test("images record their alt text, including when it is absent", () => {
    const images = extractImages(
      '<img src="/b.png" alt="B"><img src="/a.png">'
    );

    expect(images).toEqual([
      { src: "/a.png", alt: null },
      { src: "/b.png", alt: "B" },
    ]);
  });

  test("SEO extraction reads the tags the shell renders", () => {
    const seo = extractSeo(
      `<title>A &amp; B</title>
       <meta name="description" content="Desc">
       <link rel="canonical" href="https://baseline.test/">
       <meta property="og:type" content="website">
       <meta name="twitter:card" content="summary_large_image">
       <script type="application/ld+json">{"@type":"Person"}</script>`
    );

    expect(seo.title).toBe("A & B");
    expect(seo.description).toBe("Desc");
    expect(seo.canonical).toBe("https://baseline.test/");
    expect(seo.ogType).toBe("website");
    expect(seo.twitterCard).toBe("summary_large_image");
    expect(seo.structuredData).toEqual([{ "@type": "Person" }]);
  });

  test("JSON hashing ignores key order but not values", () => {
    expect(stableJsonHash('{"a":1,"b":[2,3]}')).toBe(
      stableJsonHash('{"b":[2,3],"a":1}')
    );
    expect(stableJsonHash('{"a":1}')).not.toBe(stableJsonHash('{"a":2}'));
  });
});

describe("artifact", () => {
  test("a missing baseline explains how to create one", async () => {
    await expect(
      readGoldenContract("baseline/does-not-exist.json")
    ).rejects.toThrow(/baseline:capture/);
  });

  test("the committed artifact is the one the tooling reads", async () => {
    expect(await Bun.file(BASELINE_ARTIFACT_PATH).exists()).toBe(true);
  });
});
