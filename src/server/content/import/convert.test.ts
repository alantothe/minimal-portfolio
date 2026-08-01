/**
 * The legacy conversion rules.
 *
 * The two fragments in `src/config/index.ts` are quoted here verbatim, because
 * the point of these tests is not that the converter handles HTML in general —
 * it is that it handles *these two strings* and refuses everything else.
 */

import { describe, expect, test } from "bun:test";
import {
  convertShortCopy,
  htmlFragmentToMarkdown,
  stripLeadingHeading,
} from "./convert";

const CONTACT = { contactEmail: "alanmalpartida@gmail.com" };

/** Verbatim from `homeConfig.professional.intro`. */
const LEGACY_INTRO = `Hi there, I'm Alan. I'm a <strong>Founding Engineer at Questurian</strong>, building platforms that help travelers explore the world.`;

/** Verbatim from `homeConfig.professional.bio`. */
const LEGACY_BIO = `I built this space to showcase my <a class="home-inline-link" href="/projects" data-spa-link>projects</a> and share my process. The site is intentionally minimal, just my work and occasional thoughts on what I'm exploring. Take a look around — if you have questions or want to chat about something, feel free to <span id="copy-email" data-email="alanmalpartida@gmail.com">reach out</span>.`;

describe("the two real fragments", () => {
  test("the intro converts to exactly the expected Markdown", () => {
    expect(htmlFragmentToMarkdown(LEGACY_INTRO, CONTACT)).toEqual({
      status: "converted",
      markdown:
        "Hi there, I'm Alan. I'm a **Founding Engineer at Questurian**, building platforms that help travelers explore the world.",
    });
  });

  test("the bio converts to exactly the expected Markdown", () => {
    expect(htmlFragmentToMarkdown(LEGACY_BIO, CONTACT)).toEqual({
      status: "converted",
      markdown:
        "I built this space to showcase my [projects](/projects) and share my process. " +
        "The site is intentionally minimal, just my work and occasional thoughts on what I'm exploring. " +
        "Take a look around — if you have questions or want to chat about something, feel free to " +
        "[reach out](mailto:alanmalpartida@gmail.com).",
    });
  });

  test("neither result carries a class, id, or data hook", () => {
    // #36: content stores none of these. The click-to-copy behaviour becomes
    // the renderer's job.
    for (const html of [LEGACY_INTRO, LEGACY_BIO]) {
      const outcome = htmlFragmentToMarkdown(html, CONTACT);
      expect(outcome.status).toBe("converted");
      const markdown = (outcome as { markdown: string }).markdown;

      for (const hook of [
        "class=",
        "id=",
        "data-",
        "home-inline-link",
        "copy-email",
      ]) {
        expect(markdown).not.toContain(hook);
      }
    }
  });

  test("both results pass the restricted short profile", () => {
    // A conversion that produces Markdown the renderer would reject is a bug
    // in these rules.
    expect(
      convertShortCopy("introMarkdown", LEGACY_INTRO, CONTACT).findings
    ).toEqual([]);
    expect(
      convertShortCopy("bioMarkdown", LEGACY_BIO, CONTACT).findings
    ).toEqual([]);
  });

  test("the em dash survives", () => {
    const outcome = htmlFragmentToMarkdown(LEGACY_BIO, CONTACT);
    expect((outcome as { markdown: string }).markdown).toContain("—");
  });
});

describe("failing closed", () => {
  test("an unrecognised tag stops the import", () => {
    for (const html of [
      "Text with <b>bold</b>",
      "Text with <script>alert(1)</script>",
      "<div>wrapped</div>",
      "<img src='x'>",
      "Text with <span>no data-email</span>",
    ]) {
      const outcome = htmlFragmentToMarkdown(html, CONTACT);

      // Not dropped, not passed through. A human looks.
      expect(outcome.status).toBe("unsupported");
    }
  });

  test("names the construct it could not handle", () => {
    const outcome = htmlFragmentToMarkdown("Hi <b>there</b>", CONTACT);
    expect(outcome).toMatchObject({
      status: "unsupported",
      reason: "unsupported_html_construct",
      detail: "<b>",
    });
  });

  test("a contact span for a different address is refused", () => {
    // A stale source must not be able to publish an address nobody configured.
    const outcome = htmlFragmentToMarkdown(
      '<span id="copy-email" data-email="attacker@evil.test">reach out</span>',
      CONTACT
    );

    expect(outcome.status).toBe("unsupported");
  });

  test("an anchor to an unsafe target is refused", () => {
    for (const href of [
      "javascript:alert(1)",
      "http://example.com",
      "//evil.test",
      "data:text/html,x",
    ]) {
      expect(
        htmlFragmentToMarkdown(`<a href="${href}">label</a>`, CONTACT).status
      ).toBe("unsupported");
    }
  });

  test("an https anchor is allowed", () => {
    expect(
      htmlFragmentToMarkdown('<a href="https://example.com">label</a>', CONTACT)
    ).toEqual({
      status: "converted",
      markdown: "[label](https://example.com)",
    });
  });

  test("conversion failure surfaces as a blocking finding", () => {
    const { markdown, findings } = convertShortCopy(
      "introMarkdown",
      "Hi <b>there</b>",
      CONTACT
    );

    expect(markdown).toBe("");
    expect(findings).toEqual([
      {
        field: "introMarkdown",
        code: "unsupported_html_construct",
        severity: "error",
      },
    ]);
  });
});

describe("escaping", () => {
  test("Markdown syntax in legacy prose is escaped, not activated", () => {
    // Converting prose into a markup language without escaping means a stray
    // asterisk silently becomes emphasis.
    expect(
      htmlFragmentToMarkdown("<strong>2 * 3 * 4</strong>", CONTACT)
    ).toEqual({
      status: "converted",
      markdown: "**2 \\* 3 \\* 4**",
    });
  });

  test("entities are decoded", () => {
    expect(
      htmlFragmentToMarkdown("Tom &amp; Jerry &mdash; friends", CONTACT)
    ).toEqual({
      status: "converted",
      markdown: "Tom & Jerry — friends",
    });
  });

  test("an encoded bracket cannot become a tag", () => {
    // Decoding before the tag scan would turn this into markup.
    expect(
      htmlFragmentToMarkdown("&lt;script&gt;alert(1)&lt;/script&gt;", CONTACT)
    ).toEqual({
      status: "converted",
      markdown: "<script>alert(1)</script>",
    });
  });
});

describe("the duplicated Blog H1", () => {
  const TITLE =
    "Who Is Alan Malpartida - Software Engineer, Founder, and Builder";

  test("strips the real post's leading H1", () => {
    const body = `# ${TITLE}\n\nHey, I'm Alan Malpartida.\n\n## What I Do\n\nI design and build.`;

    expect(stripLeadingHeading(body, TITLE)).toEqual({
      status: "stripped",
      body: "Hey, I'm Alan Malpartida.\n\n## What I Do\n\nI design and build.",
    });
  });

  test("strips exactly one, leaving a second alone", () => {
    const body = `# ${TITLE}\n\n# Another\n\nText.`;
    const outcome = stripLeadingHeading(body, TITLE);

    expect(outcome.status).toBe("stripped");
    expect((outcome as { body: string }).body).toContain("# Another");
  });

  test("a body with no leading H1 is left untouched", () => {
    expect(stripLeadingHeading("## Section\n\nText.", TITLE)).toEqual({
      status: "absent",
      body: "## Section\n\nText.",
    });
  });

  test("a mismatch stops the import instead of deleting the heading", () => {
    // Silently discarding it would delete content the author wrote.
    expect(
      stripLeadingHeading("# A different heading\n\nText.", TITLE)
    ).toMatchObject({
      status: "mismatch",
      found: "A different heading",
      expected: TITLE,
    });
  });

  test("whitespace differences do not count as a mismatch", () => {
    expect(stripLeadingHeading(`#    ${TITLE}   \n\nText.`, TITLE).status).toBe(
      "stripped"
    );
  });

  test("an H2 that matches the title is not stripped", () => {
    // Only H1 competes with the page title.
    expect(stripLeadingHeading(`## ${TITLE}\n\nText.`, TITLE).status).toBe(
      "absent"
    );
  });
});
