/**
 * The schema gate.
 *
 * The property that matters most here is the one #32 states outright: content
 * storage rejects unknown fields rather than silently retaining arbitrary JSON.
 * A field that survives parsing is a field some future renderer can be talked
 * into trusting, so the tests push unexpected keys in at every level — top
 * level, inside a media reference, inside SEO, inside a social link.
 *
 * The second property is the draft/publish split: everything the Owner is still
 * working on must be storable, and nothing incomplete must be publishable.
 */

import { describe, expect, test } from "bun:test";
import {
  CONTENT_SCHEMA_VERSION,
  isPublishable,
  migrateContentData,
  parseContentData,
} from "./schema";
import { hasBlockingError } from "./validation";
import type { ContentType } from "./identity";

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

/** The live Home values, as the importer will present them. */
const HOME = {
  displayName: "Alan Malpartida",
  email: "alanmalpartida@gmail.com",
  githubUsername: "alantothe",
  professionalTitle: "Founding Engineer at Questurian",
  introMarkdown:
    "Hi there, I'm Alan. I'm a **Founding Engineer at Questurian**, building platforms that help travelers explore the world.",
  bioMarkdown:
    "I built this space to showcase my [projects](/projects) and share my process.",
  portrait: { mediaAssetId: "media-1", alt: "Alan Malpartida" },
  seo: { title: null, description: null, sharingImage: null },
};

const PROJECT = {
  title: "Questurian",
  summary:
    "A full-stack travel publishing platform connecting structured destination data, editorial tooling, media pipelines, and location-first discovery.",
  technologies: ["TypeScript", "Bun"],
  card: { mediaAssetId: "media-2", alt: "Questurian" },
  gallery: [],
  videoUrl: null,
  bodyMarkdown: "## Context\n\nQuesturian is a travel publishing product.",
  seo: { title: null, description: null, sharingImage: null },
};

const BLOG_POST = {
  title: "Who Is Alan Malpartida - Software Engineer, Founder, and Builder",
  excerpt:
    "Alan Malpartida is a software engineer and founding engineer at Questurian, a travel tech startup.",
  bodyMarkdown: "Hey, I'm Alan Malpartida.\n\n## What I Do\n\nI build things.",
  sharingImage: null,
  seo: { title: null, description: null, sharingImage: null },
};

const ABOUT = {
  introMarkdown: "I'm a web developer and founder of Questurian.",
  hobbiesMarkdown: "Outside work, I'm usually hunting down local food.",
  socialLinks: [{ label: "Github", url: "https://github.com/alantothe" }],
  featuredTitle: "About Questurian",
  featuredBodyMarkdown:
    "Questurian is the travel platform.\n\nOur contributors.",
  seo: { title: null, description: null, sharingImage: null },
};

describe("today's content is publishable", () => {
  test("Home, About, Project, and Blog post all pass full validation", () => {
    // If any of these fail, the migration cannot proceed without an edit —
    // which would make it not a migration.
    expect(isPublishable("home", HOME)).toBe(true);
    expect(isPublishable("about", ABOUT)).toBe(true);
    expect(isPublishable("project", PROJECT)).toBe(true);
    expect(isPublishable("blog_post", BLOG_POST)).toBe(true);
  });

  test("branding with both images is publishable", () => {
    expect(
      isPublishable("branding", {
        logo: { mediaAssetId: "media-3", alt: "Alan Malpartida" },
        defaultSharingImage: {
          mediaAssetId: "media-4",
          alt: "Alan Malpartida",
        },
      })
    ).toBe(true);
  });
});

describe("unknown fields", () => {
  test("are refused at the top level", () => {
    const findings = parseContentData("blog_post", {
      ...BLOG_POST,
      tags: ["a", "b"],
    }).findings;

    // #32 has no tags in V1. Silently keeping them would mean a renderer could
    // later start trusting a field nobody validated.
    expect(findings).toContainEqual({
      field: "tags",
      code: "unknown_field",
      severity: "error",
    });
  });

  test("are refused inside a media reference", () => {
    const findings = parseContentData("home", {
      ...HOME,
      portrait: {
        mediaAssetId: "media-1",
        alt: "Alan",
        transformation: "w_9999",
      },
    }).findings;

    // Transformation syntax must never reach storage: the renderer picks from
    // a closed enum, and a stored transformation would be an owner-supplied one.
    expect(codes(findings)).toContain("unknown_field");
  });

  test("are refused inside SEO and inside a social link", () => {
    expect(
      codes(
        parseContentData("home", {
          ...HOME,
          seo: {
            title: null,
            description: null,
            canonical: "https://evil.test",
          },
        }).findings
      )
    ).toContain("unknown_field");

    expect(
      codes(
        parseContentData("about", {
          ...ABOUT,
          socialLinks: [
            { label: "Github", url: "https://github.com/x", rel: "me" },
          ],
        }).findings
      )
    ).toContain("unknown_field");
  });

  test("a field belonging to another type is still unknown", () => {
    // `card` is a Project field. On a Blog post it is noise.
    expect(
      codes(
        parseContentData("blog_post", { ...BLOG_POST, card: null }).findings
      )
    ).toContain("unknown_field");
  });
});

describe("draft versus publish", () => {
  test("an empty draft stores without blocking", () => {
    for (const type of [
      "home",
      "about",
      "branding",
      "project",
      "blog_post",
    ] as ContentType[]) {
      const findings = parseContentData(type, {}, "draft").findings;
      expect(hasBlockingError(findings)).toBe(false);
    }
  });

  test("an empty draft is not publishable", () => {
    for (const type of ["home", "about", "project", "blog_post"] as const) {
      expect(isPublishable(type, {})).toBe(false);
    }
  });

  test("a draft may hold a half-written body with no title", () => {
    const findings = parseContentData(
      "blog_post",
      { bodyMarkdown: "Half a thought." },
      "draft"
    ).findings;

    // Losing the paragraph because it had no title yet would be worse than
    // storing it.
    expect(hasBlockingError(findings)).toBe(false);
  });

  test("a draft may hold either half of a social link", () => {
    for (const socialLink of [
      { label: "GitHub", url: "" },
      { label: "", url: "https://github.com/example" },
    ]) {
      const findings = parseContentData(
        "about",
        { ...ABOUT, socialLinks: [socialLink] },
        "draft"
      ).findings;
      expect(hasBlockingError(findings)).toBe(false);
    }

    const publishFindings = parseContentData(
      "about",
      { ...ABOUT, socialLinks: [{ label: "GitHub", url: "" }] },
      "publish"
    ).findings;
    expect(codes(publishFindings)).toContain("required");
  });

  test("unsafe values block even in a draft", () => {
    // Size and safety are storage properties, not editorial ones.
    expect(
      hasBlockingError(
        parseContentData("blog_post", { title: "a".repeat(200) }, "draft")
          .findings
      )
    ).toBe(true);

    expect(
      hasBlockingError(
        parseContentData(
          "about",
          {
            ...ABOUT,
            socialLinks: [{ label: "Bad", url: "javascript:alert(1)" }],
          },
          "draft"
        ).findings
      )
    ).toBe(true);
  });

  test("alt text is required to publish an image but not to save one", () => {
    const withoutAlt = { ...HOME, portrait: { mediaAssetId: "m", alt: "" } };

    expect(
      hasBlockingError(parseContentData("home", withoutAlt, "draft").findings)
    ).toBe(false);
    expect(
      codes(parseContentData("home", withoutAlt, "publish").findings)
    ).toContain("alt_text_required");
  });
});

describe("field-level refusals", () => {
  test("Project technologies accept twenty labels and reject malformed entries", () => {
    expect(
      isPublishable("project", {
        ...PROJECT,
        technologies: Array.from({ length: 20 }, (_, index) => `Tool ${index}`),
      })
    ).toBe(true);
    expect(
      codes(
        parseContentData("project", {
          ...PROJECT,
          technologies: Array.from(
            { length: 21 },
            (_, index) => `Tool ${index}`
          ),
        }).findings
      )
    ).toContain("too_many");
    expect(
      codes(
        parseContentData("project", {
          ...PROJECT,
          technologies: ["TypeScript", 42],
        }).findings
      )
    ).toContain("expected_string_entries");
  });

  test("Project gallery accepts eight images and refuses a ninth", () => {
    const gallery = Array.from({ length: 8 }, (_, index) => ({
      mediaAssetId: `media-${index}`,
      alt: `Screenshot ${index + 1}`,
    }));

    expect(isPublishable("project", { ...PROJECT, gallery })).toBe(true);
    expect(
      codes(
        parseContentData("project", {
          ...PROJECT,
          gallery: [...gallery, gallery[0]],
        }).findings
      )
    ).toContain("too_many");
  });

  test("Project video accepts local 1080p-friendly formats and rejects arbitrary hosts", () => {
    expect(
      isPublishable("project", { ...PROJECT, videoUrl: "/public/demo.mp4" })
    ).toBe(true);
    expect(
      isPublishable("project", {
        ...PROJECT,
        videoUrl: "https://evil.test/demo.mp4",
      })
    ).toBe(false);
  });

  test("more than eight social links blocks", () => {
    expect(
      isPublishable("about", {
        ...ABOUT,
        socialLinks: Array.from({ length: 9 }, (_, i) => ({
          label: `Link ${i}`,
          url: "https://example.com",
        })),
      })
    ).toBe(false);
  });

  test("a non-object payload is refused outright", () => {
    for (const raw of ["a string", 42, [], null]) {
      expect(() => parseContentData("home", raw)).toThrow();
    }
  });
});

describe("the Markdown boundary is wired in, not just the size limit", () => {
  test("a Project body containing raw HTML blocks", () => {
    expect(
      isPublishable("project", {
        ...PROJECT,
        bodyMarkdown: "## Context\n\n<script>alert(1)</script>",
      })
    ).toBe(false);
  });

  test("a Blog post body with an H1 blocks, because the title owns it", () => {
    expect(
      isPublishable("blog_post", {
        ...BLOG_POST,
        bodyMarkdown: "# Competing title\n\nText.",
      })
    ).toBe(false);
  });

  test("a Home intro using body-only structure blocks", () => {
    // Home copy sits inside a template that owns the page structure.
    expect(
      isPublishable("home", { ...HOME, introMarkdown: "## A heading" })
    ).toBe(false);
  });

  test("an unsafe link inside prose blocks", () => {
    expect(
      isPublishable("home", {
        ...HOME,
        bioMarkdown: "Click [here](javascript:alert(1)) now.",
      })
    ).toBe(false);
  });

  test("an arbitrary image URL in a body blocks", () => {
    expect(
      isPublishable("project", {
        ...PROJECT,
        bodyMarkdown: "## Context\n\n![x](https://evil.test/tracker.gif)",
      })
    ).toBe(false);
  });

  test("a draft is still blocked by unsafe Markdown", () => {
    // Safety is a storage property, so it does not wait for publish.
    expect(
      hasBlockingError(
        parseContentData(
          "project",
          { bodyMarkdown: "<iframe src='https://evil.test'></iframe>" },
          "draft"
        ).findings
      )
    ).toBe(true);
  });

  test("an over-limit body is rejected on size without being parsed", () => {
    // The body is over the limit *and* full of raw HTML. Only the size finding
    // should appear: parsing a quarter-million-character string that is already
    // rejected spends exactly the time an attacker wanted to cost us.
    const findings = parseContentData(
      "project",
      {
        ...PROJECT,
        bodyMarkdown: "<script>alert(1)</script>".repeat(11_000),
      },
      "publish"
    ).findings;

    expect(codes(findings)).toContain("too_long");
    expect(codes(findings).some((code) => code.startsWith("disallowed"))).toBe(
      false
    );
  });
});

describe("normalisation", () => {
  test("the schema version is a single exported constant", () => {
    expect(CONTENT_SCHEMA_VERSION).toBe(2);
  });

  test("version one Projects lose retired fields but keep technologies", () => {
    const migrated = migrateContentData(
      "project",
      { ...PROJECT, role: "Engineer" },
      1
    );

    expect(migrated).toEqual(PROJECT);
    expect(isPublishable("project", migrated)).toBe(true);
  });
});
