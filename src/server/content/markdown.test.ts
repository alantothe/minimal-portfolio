/**
 * The restricted-Markdown boundary.
 *
 * The tests are organised around what must never come out the other side.
 * Every assertion about injection checks the *rendered HTML*, not the findings
 * list — a finding that something was rejected is worthless if the thing was
 * rendered anyway, and the two are produced by the same pass precisely so they
 * cannot disagree.
 */

import { describe, expect, test } from "bun:test";
import {
  MEDIA_REFERENCE_PREFIX,
  renderMarkdown,
  validateMarkdown,
  type MarkdownContext,
} from "./markdown";

const IMAGE = {
  url: "https://res.cloudinary.com/c/image/upload/t_portfolio_wide/v1/portfolio/a.png",
  width: 1600,
  height: 900,
};

const context: MarkdownContext = {
  resolveMedia: (id) => (id === "known-asset" ? IMAGE : null),
};

function body(source: string, ctx: MarkdownContext | null = null) {
  return renderMarkdown("bodyMarkdown", source, "body", ctx);
}

function short(source: string) {
  return renderMarkdown("introMarkdown", source, "short");
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("nothing executable survives", () => {
  test("script tags are dropped and their contents left inert", () => {
    const { html, findings } = body("Hello <script>alert(1)</script> world");

    // The tags themselves never reach the output. What was between them
    // survives as ordinary escaped text — inert, and still what the author
    // typed, which is the right outcome for a field that stores prose.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("</script");
    expect(html).toBe("<p>Hello alert(1) world</p>");
    expect(codes(findings)).toContain("disallowed_inline:html");
  });

  test("every raw HTML construct #32 forbids is refused", () => {
    for (const source of [
      "<iframe src='https://evil.test'></iframe>",
      "<style>body{display:none}</style>",
      "<img src=x onerror=alert(1)>",
      "<div class='custom'>text</div>",
      "<object data='x'></object>",
      "<embed src='x'>",
      "<a href='javascript:alert(1)'>click</a>",
      "<svg onload=alert(1)></svg>",
    ]) {
      const { html } = body(source);

      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("<style");
      expect(html).not.toContain("onerror");
      expect(html).not.toContain("onload");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<object");
      expect(html).not.toContain("<embed");
      expect(html).not.toContain("class='custom'");
    }
  });

  test("angle brackets in ordinary prose are escaped, not dropped", () => {
    // The other half of the rule: text that merely looks like markup is content.
    const { html } = body("Use `a < b` when a is smaller");
    expect(html).toContain("&lt;");
  });

  test("a quote in text cannot break out of an attribute", () => {
    const { html } = body('![He said "hi"](media:known-asset)', context);
    expect(html).toContain("&quot;");
    expect(html).not.toContain('alt="He said "hi""');
  });
});

describe("links", () => {
  test("safe targets render", () => {
    for (const href of [
      "/projects",
      "#section",
      "https://example.com",
      "mailto:alanmalpartida@gmail.com",
    ]) {
      const { html, findings } = body(`[label](${href})`);
      expect(findings).toEqual([]);
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("unsafe targets lose the link but keep the sentence", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://example.com",
      "//evil.test",
    ]) {
      const { html, findings } = body(`Read [the label](${href}) now`);

      expect(html).not.toContain("<a ");
      // The reader still gets the prose; only the navigation is removed.
      expect(html).toContain("the label");
      expect(findings.length).toBeGreaterThan(0);
    }
  });

  test("external links get noopener, internal ones do not", () => {
    // Without `noopener` the opened page can navigate this one via
    // `window.opener`.
    expect(body("[x](https://example.com)").html).toContain(
      'rel="noopener noreferrer"'
    );
    expect(body("[x](/projects)").html).not.toContain("rel=");
  });
});

describe("inline media", () => {
  test("a known asset renders at the fixed variant with intrinsic size", () => {
    const { html, findings } = body("![A diagram](media:known-asset)", context);

    expect(findings).toEqual([]);
    expect(html).toContain(`src="${IMAGE.url}"`);
    expect(html).toContain('width="1600"');
    expect(html).toContain('height="900"');
    expect(html).toContain('alt="A diagram"');
    expect(html).toContain('loading="lazy"');
  });

  test("a title becomes a caption", () => {
    const { html } = body(
      '![A diagram](media:known-asset "Figure 1")',
      context
    );

    expect(html).toContain("<figcaption>Figure 1</figcaption>");
  });

  test("an arbitrary image URL fails closed", () => {
    for (const href of [
      "https://evil.test/tracker.gif",
      // Even the right delivery host: the reference must be an asset the
      // application recorded, not a URL that happens to resolve.
      "https://res.cloudinary.com/c/image/upload/w_9999/x.png",
      "/public/og.png",
    ]) {
      const { html, findings } = body(`![alt](${href})`, context);

      // An image the application did not record is one it cannot resolve,
      // verify, size, or delete.
      expect(html).not.toContain("<img");
      expect(codes(findings)).toContain("arbitrary_image_url");
    }
  });

  test("a data URI never becomes an image", () => {
    // Refused a step earlier than the others — marked treats the embedded
    // markup as raw HTML, so the image token never forms. Either way nothing
    // renders, which is the property that matters.
    const { html, findings } = body(
      "![alt](data:image/svg+xml,<svg onload=alert(1)>)",
      context
    );

    expect(html).not.toContain("<img");
    expect(html).not.toContain("onload");
    expect(findings.length).toBeGreaterThan(0);
  });

  test("transformation syntax cannot be smuggled through the reference", () => {
    const { html, findings } = body(
      "![alt](media:known-asset/w_9999)",
      context
    );

    // The id is resolved as a whole; it is never concatenated into a URL.
    expect(html).not.toContain("w_9999");
    expect(codes(findings)).toContain("media_asset_unavailable");
  });

  test("an unknown asset renders nothing and says so", () => {
    const { html, findings } = body("![alt](media:missing)", context);

    expect(html).not.toContain("<img");
    expect(codes(findings)).toContain("media_asset_unavailable");
  });

  test("missing alt text is a blocking finding", () => {
    expect(codes(body("![](media:known-asset)", context).findings)).toContain(
      "alt_text_required"
    );
  });

  test("validation without a resolver does not fault a well-formed reference", () => {
    // A draft may reference an asset that is still uploading.
    expect(
      validateMarkdown("bodyMarkdown", "![alt](media:known-asset)", "body")
    ).toEqual([]);
  });

  test("the reference prefix is what the importer will write", () => {
    expect(MEDIA_REFERENCE_PREFIX).toBe("media:");
  });
});

describe("headings", () => {
  test("H2 through H4 render", () => {
    for (const depth of [2, 3, 4]) {
      const { html, findings } = body(`${"#".repeat(depth)} Heading`);
      expect(findings).toEqual([]);
      expect(html).toBe(`<h${depth}>Heading</h${depth}>`);
    }
  });

  test("H1 is refused, because the page title owns it", () => {
    const { html, findings } = body("# Competing title");

    expect(html).toBe("");
    expect(codes(findings)).toContain("heading_level_not_allowed:1");
  });

  test("H5 and H6 are refused", () => {
    for (const depth of [5, 6]) {
      expect(codes(body(`${"#".repeat(depth)} Deep`).findings)).toContain(
        `heading_level_not_allowed:${depth}`
      );
    }
  });
});

describe("the body profile", () => {
  test("renders the constructs #32 allows", () => {
    const { html, findings } = body(
      [
        "## Context",
        "",
        "Text with **strong**, *emphasis*, and `code`.",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "> a quote",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "---",
        "",
        "```js",
        "const x = 1;",
        "```",
      ].join("\n")
    );

    expect(findings).toEqual([]);
    for (const fragment of [
      "<h2>Context</h2>",
      "<strong>strong</strong>",
      "<em>emphasis</em>",
      "<code>code</code>",
      "<ul><li>",
      "<ol><li>",
      "<blockquote>",
      "<table>",
      "<hr>",
      '<pre><code class="language-js">',
    ]) {
      expect(html).toContain(fragment);
    }
  });

  test("a fenced language cannot inject an attribute", () => {
    const { html } = body('```js" onload="alert(1)\nx\n```');

    // Rejected rather than scrubbed: the block renders with no language at all,
    // so there is no attribute to break out of.
    expect(html).toBe("<pre><code>x</code></pre>");
    expect(html).not.toContain("onload=");
    expect(html).not.toContain("class=");
  });

  test("code content is escaped, not executed", () => {
    const { html } = body("```\n<script>alert(1)</script>\n```");

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("the real Questurian body opening renders cleanly", () => {
    const { findings } = body(
      [
        "## Context",
        "",
        "Questurian is a travel publishing and discovery product built around structured places.",
        "",
        "## What I built",
        "",
        "- A Next.js public application with hierarchical location routes.",
      ].join("\n")
    );

    expect(findings).toEqual([]);
  });
});

describe("the short profile", () => {
  test("renders the Home intro and bio as the importer will produce them", () => {
    const intro = short(
      "Hi there, I'm Alan. I'm a **Founding Engineer at Questurian**, building platforms."
    );
    const bio = short(
      "I built this space to showcase my [projects](/projects) and share my process."
    );

    expect(intro.findings).toEqual([]);
    expect(intro.html).toContain(
      "<strong>Founding Engineer at Questurian</strong>"
    );
    expect(bio.findings).toEqual([]);
    expect(bio.html).toContain('<a href="/projects">projects</a>');
  });

  test("refuses structure the surrounding template owns", () => {
    // These fields sit inside a page whose layout is not editable.
    for (const [source, code] of [
      ["## Heading", "disallowed_block:heading"],
      ["- a\n- b", "disallowed_block:list"],
      ["> quote", "disallowed_block:blockquote"],
      ["---", "disallowed_block:hr"],
      ["```\ncode\n```", "disallowed_block:code"],
    ] as const) {
      expect(codes(short(source).findings)).toContain(code);
    }
  });

  test("refuses inline code and images", () => {
    expect(codes(short("Some `code` here").findings)).toContain(
      "disallowed_inline:codespan"
    );
    expect(codes(short("![alt](media:known-asset)").findings)).toContain(
      "disallowed_inline:image"
    );
  });

  test("still refuses raw HTML", () => {
    expect(short("<b>bold</b>").html).not.toContain("<b>");
  });
});

describe("edge cases", () => {
  test("empty source renders nothing without complaining", () => {
    for (const source of ["", "   ", "\n\n"]) {
      expect(renderMarkdown("f", source, "body")).toEqual({
        html: "",
        findings: [],
      });
    }
  });

  test("strikethrough is not in #32's list and is refused", () => {
    expect(codes(body("~~gone~~").findings)).toContain("disallowed_inline:del");
  });

  test("nested emphasis inside a link still renders", () => {
    expect(body("[**bold link**](/projects)").html).toBe(
      '<p><a href="/projects"><strong>bold link</strong></a></p>'
    );
  });

  test("an ordered list keeps a non-default start", () => {
    expect(body("3. three\n4. four").html).toContain('<ol start="3">');
  });
});
