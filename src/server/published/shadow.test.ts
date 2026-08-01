/**
 * Whether the parity gate can actually fail.
 *
 * A classifier that explains everything is indistinguishable from no gate at
 * all, so most of these tests hand it a difference that *should* block and check
 * that it does. The allowlist rules are tested at their edges rather than at
 * their centre: `media-adoption` matching a real adoption proves little, but
 * refusing an image that vanished, or one delivered outside the variant enum,
 * is the property the migration depends on.
 */

import { describe, expect, test } from "bun:test";
import type { RouteSnapshot, SeoSnapshot } from "../../baseline/contract";
import { compareContract, compareJsonPayloads, compareRoute } from "./shadow";
import { normalizeVisibleText } from "../../baseline/normalize";

const ADOPTED =
  "https://res.cloudinary.com/cloud/image/upload/t_portfolio_card/v1700/portfolio/abc.png";
const LEGACY_CLOUDINARY =
  "https://res.cloudinary.com/old/image/upload/c_fill,w_300,h_180/v1761780791/questura.png";

function seo(overrides: Partial<SeoSnapshot> = {}): SeoSnapshot {
  return {
    title: "Title",
    description: "Description",
    canonical: "https://baseline.test/",
    ogSiteName: "Site",
    ogType: "website",
    ogTitle: "Title",
    ogDescription: "Description",
    ogUrl: "https://baseline.test/",
    ogImage: "https://baseline.test/public/og.png",
    twitterCard: "summary_large_image",
    twitterTitle: "Title",
    twitterDescription: "Description",
    twitterImage: "https://baseline.test/public/og.png",
    articlePublishedTime: null,
    structuredData: [],
    ...overrides,
  };
}

function route(overrides: Partial<RouteSnapshot> = {}): RouteSnapshot {
  return {
    path: "/",
    kind: "page",
    status: 200,
    contentType: "text/html",
    cacheControl: "no-cache",
    location: null,
    bodyHash: "body",
    textHash: "text",
    headings: ["h1:Hello"],
    internalLinks: ["/about"],
    images: [],
    seo: seo(),
    ...overrides,
  };
}

function rules(parity: ReturnType<typeof compareRoute>): string[] {
  return parity.differences.map((difference) => difference.rule ?? "NONE");
}

describe("differences that must block", () => {
  test("a changed status diverges", () => {
    const parity = compareRoute(route(), route({ status: 404 }));

    expect(parity.status).toBe("diverged");
  });

  test("changed visible text diverges", () => {
    const parity = compareRoute(route(), route({ textHash: "different" }));

    expect(parity.status).toBe("diverged");
  });

  test("a lost heading diverges", () => {
    const parity = compareRoute(route(), route({ headings: [] }));

    expect(parity.status).toBe("diverged");
  });

  test("a changed internal link diverges", () => {
    const parity = compareRoute(route(), route({ internalLinks: ["/gone"] }));

    expect(parity.status).toBe("diverged");
  });

  test("a changed canonical URL diverges", () => {
    const parity = compareRoute(
      route(),
      route({ seo: seo({ canonical: "https://elsewhere.test/" }) })
    );

    expect(parity.status).toBe("diverged");
  });

  test("a changed cache header diverges", () => {
    const parity = compareRoute(route(), route({ cacheControl: "no-store" }));

    expect(parity.status).toBe("diverged");
  });
});

describe("markup is allowlisted, meaning is not", () => {
  test("a different body hash alone is explained", () => {
    const parity = compareRoute(route(), route({ bodyHash: "other" }));

    expect(parity.status).toBe("allowlisted");
    expect(rules(parity)).toEqual(["rendered-markup"]);
  });

  test("a different body hash does not excuse a text change", () => {
    const parity = compareRoute(
      route(),
      route({ bodyHash: "other", textHash: "other" })
    );

    expect(parity.status).toBe("diverged");
  });
});

describe("media adoption", () => {
  test("a repository path becoming a delivered variant is explained", () => {
    const parity = compareRoute(
      route({ images: [{ src: "/avatar.webp", alt: "Ada" }] }),
      route({ images: [{ src: ADOPTED, alt: "Ada" }] })
    );

    expect(parity.status).toBe("allowlisted");
    expect(rules(parity)).toContain("media-adoption");
  });

  test("an absolute repository URL is also an adoption source", () => {
    const parity = compareRoute(
      route(),
      route({ seo: seo({ ogImage: ADOPTED, twitterImage: ADOPTED }) })
    );

    expect(parity.status).toBe("allowlisted");
  });

  test("an image that disappeared is not an adoption", () => {
    const parity = compareRoute(
      route({ images: [{ src: "/avatar.webp", alt: "Ada" }] }),
      route({ images: [{ src: "", alt: "Ada" }] })
    );

    expect(parity.status).toBe("diverged");
  });

  test("a URL outside the closed variant enum is not an adoption", () => {
    // The legacy card was already a Cloudinary URL. Accepting any Cloudinary
    // host would let a hand-written transformation pass as a delivered variant,
    // which is exactly the property Strict Transformations protects.
    const parity = compareRoute(
      route({ images: [{ src: "/card.png", alt: "Card" }] }),
      route({ images: [{ src: LEGACY_CLOUDINARY, alt: "Card" }] })
    );

    expect(parity.status).toBe("diverged");
  });

  test("swapping in a different repository image is not an adoption", () => {
    const parity = compareRoute(
      route({ images: [{ src: "/avatar.webp", alt: "Ada" }] }),
      route({ images: [{ src: "/someone-else.webp", alt: "Ada" }] })
    );

    expect(parity.status).toBe("diverged");
  });
});

describe("images compare as a set", () => {
  test("adoption reordering the sorted list is not a difference storm", () => {
    // The contract sorts images by src, so adopting one moves it past the
    // others. Compared by index this reads as three changed images.
    const parity = compareRoute(
      route({
        images: [
          { src: "/avatar.webp", alt: "Ada" },
          { src: "/public/logo.png", alt: "Logo" },
        ],
      }),
      route({
        images: [
          { src: "/public/logo.png", alt: "Logo" },
          { src: ADOPTED, alt: "Ada" },
        ],
      })
    );

    expect(parity.status).toBe("allowlisted");
    expect(parity.differences).toHaveLength(1);
  });

  test("an image the published page dropped is reported", () => {
    const parity = compareRoute(
      route({
        images: [
          { src: "/a.webp", alt: "A" },
          { src: "/b.webp", alt: "B" },
        ],
      }),
      route({ images: [{ src: "/a.webp", alt: "A" }] })
    );

    expect(parity.status).toBe("diverged");
    expect(
      parity.differences.some((difference) =>
        difference.path.includes("missing")
      )
    ).toBe(true);
  });

  test("an image the published page invented is reported", () => {
    const parity = compareRoute(
      route({ images: [{ src: "/a.webp", alt: "A" }] }),
      route({
        images: [
          { src: "/a.webp", alt: "A" },
          { src: "/surprise.webp", alt: "?" },
        ],
      })
    );

    expect(parity.status).toBe("diverged");
    expect(
      parity.differences.some((difference) =>
        difference.path.includes("unexpected")
      )
    ).toBe(true);
  });

  test("alt text added to a previously empty alt is explained", () => {
    const parity = compareRoute(
      route({ images: [{ src: "/card.png", alt: "" }] }),
      route({ images: [{ src: "/card.png", alt: "Questurian" }] })
    );

    expect(parity.status).toBe("allowlisted");
    expect(rules(parity)).toContain("alt-text-required");
  });

  test("alt text removed is not explained", () => {
    const parity = compareRoute(
      route({ images: [{ src: "/card.png", alt: "Questurian" }] }),
      route({ images: [{ src: "/card.png", alt: "" }] })
    );

    expect(parity.status).toBe("diverged");
  });
});

describe("json payloads", () => {
  const compare = (baseline: unknown, published: unknown) =>
    compareJsonPayloads(
      JSON.stringify(baseline),
      JSON.stringify(published),
      normalizeVisibleText
    );

  test("markup fields are compared as visible text", () => {
    const differences = compare(
      { html: "<p>Hello <strong>world</strong></p>" },
      { html: "<p>Hello <b>world</b></p>" }
    );

    expect(differences).toHaveLength(0);
  });

  test("markup fields still catch missing words", () => {
    const differences = compare(
      { html: "<p>Hello world</p>" },
      { html: "<p>Hello</p>" }
    );

    expect(differences).toHaveLength(1);
  });

  test("a changed data field is reported", () => {
    const differences = compare({ views: 12 }, { views: 0 });

    expect(differences[0]?.path).toBe("payload.views");
  });

  test("a dropped list entry is reported", () => {
    const differences = compare(
      { posts: [{ slug: "a" }, { slug: "b" }] },
      { posts: [{ slug: "a" }] }
    );

    expect(differences[0]?.path).toBe("payload.posts.length");
  });

  test("a field the published payload stopped sending is reported", () => {
    const differences = compare({ secret: "value" }, {});

    expect(differences).toHaveLength(1);
  });
});

describe("the report", () => {
  test("an excluded route is not a missing one", () => {
    const contract = [route({ path: "/healthz", kind: "health" })];

    const report = compareContract(
      "gen",
      contract,
      new Map(),
      new Map([["/healthz", "Liveness, not content."]])
    );

    expect(report.totals.excluded).toBe(1);
    expect(report.totals.missing).toBe(0);
    expect(report.passed).toBe(true);
  });

  test("a route the crawl never produced fails the run", () => {
    const report = compareContract(
      "gen",
      [route({ path: "/about" })],
      new Map()
    );

    expect(report.totals.missing).toBe(1);
    expect(report.passed).toBe(false);
  });

  test("one unexplained difference fails the whole run", () => {
    const published = new Map([["/", route({ status: 500 })]]);

    const report = compareContract("gen", [route()], published);

    expect(report.passed).toBe(false);
  });

  test("a fully explained run passes", () => {
    const published = new Map([["/", route({ bodyHash: "other" })]]);

    const report = compareContract("gen", [route()], published);

    expect(report.passed).toBe(true);
    expect(report.totals.allowlisted).toBe(1);
  });
});
