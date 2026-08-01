/**
 * Turning legacy source into content the new model accepts.
 *
 * Two legacy fields hold hand-written HTML, and #36 is specific about what may
 * become of it: known `<strong>` and `<em>` become Markdown, the Home projects
 * link becomes `[projects](/projects)`, the contact span becomes a safe
 * `mailto:` link, and **content does not store classes, IDs, or `data-*`
 * hooks**. The click-to-copy behaviour those hooks drove becomes the renderer's
 * job, owned by the system, not something an Owner can edit.
 *
 * The governing decision here is that conversion **fails closed**. A construct
 * this module does not recognise stops the import and asks for a human, rather
 * than being dropped (silently losing content) or passed through (silently
 * keeping HTML the content model forbids). There are exactly two fragments to
 * convert and they are both known; anything else appearing means the source
 * changed and somebody should look.
 *
 * Every conversion is then re-checked through the same restricted-Markdown
 * profile that will render it. Producing Markdown the renderer would reject is
 * a bug this catches at import time instead of at publish time.
 */

import { validateMarkdown } from "../markdown";
import { normalizeText, type Finding } from "../validation";

export type ConversionOutcome =
  | { status: "converted"; markdown: string }
  | { status: "unsupported"; reason: string; detail: string };

/**
 * Entities that appear in the legacy fields, decoded after tags are handled so
 * an encoded bracket cannot become a tag mid-conversion.
 */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash);/g,
    (match) => ENTITIES[match] ?? match
  );
}

/**
 * Escapes characters that would otherwise become Markdown syntax.
 *
 * The legacy copy contains none of these today, but converting prose into a
 * markup language without escaping means any future apostrophe-adjacent
 * asterisk silently becomes emphasis.
 */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]])/g, "\\$1");
}

/** Rejects anything with a tag left in it. */
function containsMarkup(value: string): boolean {
  return /[<>]/.test(value);
}

interface ConversionContext {
  /** The address the contact hook is allowed to expose. */
  contactEmail: string;
}

/**
 * Converts one legacy HTML fragment to restricted Markdown.
 *
 * The order is deliberate: inline anchors and the contact span are handled
 * before emphasis, because their *labels* are plain text and must not be
 * scanned for tags twice.
 */
export function htmlFragmentToMarkdown(
  html: string,
  context: ConversionContext
): ConversionOutcome {
  let working = html;

  // The contact hook. Only the configured address is accepted: the legacy
  // markup carries the address in a `data-email` attribute, and importing
  // whatever it says would let a stale source publish a different address.
  working = working.replace(
    /<span\b[^>]*\bdata-email="([^"]*)"[^>]*>([^<]*)<\/span>/g,
    (match, email: string, label: string) => {
      if (normalizeText(email) !== context.contactEmail) {
        return match; // Left in place, so the markup check below refuses it.
      }
      return `[${escapeMarkdown(decodeEntities(label))}](mailto:${email})`;
    }
  );

  // Anchors. `class` and `data-spa-link` are dropped rather than preserved:
  // the SPA hook is presentation the system owns.
  working = working.replace(
    /<a\b[^>]*\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g,
    (match, href: string, label: string) => {
      const target = normalizeText(href);
      const safe =
        target.startsWith("/") && !target.startsWith("//")
          ? target
          : target.startsWith("https://")
            ? target
            : null;

      if (safe === null) {
        return match; // Refused by the markup check.
      }

      return `[${escapeMarkdown(decodeEntities(label))}](${safe})`;
    }
  );

  working = working.replace(
    /<strong>([^<]*)<\/strong>/g,
    (_match, text: string) => `**${escapeMarkdown(decodeEntities(text))}**`
  );

  working = working.replace(
    /<em>([^<]*)<\/em>/g,
    (_match, text: string) => `*${escapeMarkdown(decodeEntities(text))}*`
  );

  if (containsMarkup(working)) {
    // Deliberately not a best-effort strip. An unrecognised construct means the
    // source changed since these rules were written.
    const detail = /<[^>]*>/.exec(working)?.[0] ?? working.slice(0, 80);
    return {
      status: "unsupported",
      reason: "unsupported_html_construct",
      detail,
    };
  }

  return { status: "converted", markdown: decodeEntities(working) };
}

/**
 * Converts a fragment and proves the result is renderable.
 *
 * A conversion that produces Markdown the restricted profile would reject is a
 * bug in these rules, and it is much cheaper to find here than at publish.
 */
export function convertShortCopy(
  field: string,
  html: string,
  context: ConversionContext
): { markdown: string; findings: Finding[] } {
  const outcome = htmlFragmentToMarkdown(html, context);

  if (outcome.status === "unsupported") {
    return {
      markdown: "",
      findings: [{ field, code: outcome.reason, severity: "error" }],
    };
  }

  return {
    markdown: outcome.markdown,
    findings: validateMarkdown(field, outcome.markdown, "short"),
  };
}

/** Collapses runs of whitespace so two spellings of one heading compare equal. */
function normalizeHeadingText(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

export type LeadingHeadingOutcome =
  | { status: "stripped"; body: string }
  | { status: "absent"; body: string }
  | { status: "mismatch"; found: string; expected: string };

/**
 * Removes the duplicated H1 from a legacy Blog post body.
 *
 * The page template renders the title as the page's H1, so a body that also
 * opens with one would produce two — bad for the outline and for the SEO the
 * golden contract pins. #36 allows removing **exactly one** leading H1, and
 * **only** when its text matches the frontmatter title.
 *
 * A mismatch stops the import rather than guessing. If the body's first heading
 * says something different from the title, one of them is wrong, and silently
 * discarding the heading would delete content the author wrote.
 */
export function stripLeadingHeading(
  body: string,
  title: string
): LeadingHeadingOutcome {
  const match = /^\s*#\s+(.+?)\s*(?:\n|$)/.exec(body);

  if (!match) {
    return { status: "absent", body: normalizeText(body) };
  }

  const found = normalizeHeadingText(match[1]!);
  const expected = normalizeHeadingText(title);

  if (found !== expected) {
    return { status: "mismatch", found, expected };
  }

  return {
    status: "stripped",
    body: normalizeText(body.slice(match[0].length)),
  };
}
