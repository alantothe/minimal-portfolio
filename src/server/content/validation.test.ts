/**
 * The validation rules from #32.
 *
 * Two things these tests care about beyond "does the rule work". First, that
 * every value currently on the live site passes — a rule that would reject
 * today's content is a rule that blocks the migration. Second, that the
 * error/warning split holds, because a warning that blocks would make the Owner
 * unable to publish their own editorial choices.
 */

import { describe, expect, test } from "bun:test";
import {
  LIMITS,
  characterLength,
  hasBlockingError,
  normalizeText,
  slugFromTitle,
  suggestAvailableSlug,
  validateCount,
  validateEmail,
  validateHttpsUrl,
  validateMarkdownLinkTarget,
  validatePublicationDate,
  validateSeoOverrides,
  validateSlug,
  validateText,
  validateViewCount,
} from "./validation";

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

describe("the content that exists today", () => {
  test("every live slug is valid", () => {
    for (const slug of [
      "questurian",
      "minimal-portfolio",
      "who-is-alan-malpartida-software-engineer-and-founder",
    ]) {
      expect(validateSlug("slug", slug)).toEqual([]);
    }
  });

  test("every live structured URL is valid", () => {
    for (const url of [
      "https://github.com/alantothe",
      "https://github.com/Questurian/questurian",
      "https://github.com/alantothe/minimal-portfolio",
    ]) {
      expect(validateHttpsUrl("url", url)).toEqual([]);
    }
  });

  test("the live email is valid", () => {
    expect(validateEmail("email", "alanmalpartida@gmail.com")).toEqual([]);
  });

  test("the live publication date is valid", () => {
    expect(
      validatePublicationDate("date", "2026-02-11", new Date("2026-07-31"))
    ).toEqual([]);
  });

  test("the live view count is valid", () => {
    expect(validateViewCount("views", 4)).toEqual([]);
  });

  test("the one live social link is within the limit", () => {
    expect(validateCount("socialLinks", 1, LIMITS.socialLinks.max)).toEqual([]);
  });
});

describe("text fields", () => {
  test("trims the edges and leaves the inside alone", () => {
    expect(normalizeText("  hello   world  ")).toBe("hello   world");
    expect(normalizeText("line\n\nline")).toBe("line\n\nline");
  });

  test("counts code points, not UTF-16 units", () => {
    // "𝕏" is one character to a reader and two to `String.length`. Counting
    // units would silently halve the limit for anyone writing emoji or CJK.
    expect(characterLength("𝕏")).toBe(1);
    expect("𝕏".length).toBe(2);
  });

  test("an absent optional field is not an error", () => {
    expect(validateText("title", "   ", { max: 160 })).toEqual([]);
  });

  test("an absent required field is", () => {
    expect(
      codes(validateText("title", "", { max: 160 }, { required: true }))
    ).toEqual(["required"]);
  });

  test("refuses invisible control characters", () => {
    expect(
      codes(validateText("title", "Alan\u0000Malpartida", { max: 160 }))
    ).toContain("control_characters");
  });

  test("a newline is content in a block and a mistake in a line", () => {
    expect(
      validateText("bio", "one\ntwo", { max: 10_000, kind: "block" })
    ).toEqual([]);
    expect(codes(validateText("title", "one\ntwo", { max: 160 }))).toContain(
      "control_characters"
    );
  });

  test("a tab survives inside a block", () => {
    expect(
      validateText("body", "code\tsample", { max: 10_000, kind: "block" })
    ).toEqual([]);
  });

  test("too long is an error, longer than recommended is a warning", () => {
    const long = "a".repeat(LIMITS.summary.warnAfter + 1);
    const findings = validateText("summary", long, LIMITS.summary);

    expect(codes(findings)).toEqual(["longer_than_recommended"]);
    // The decisive part: an editorial opinion must never block a publish.
    expect(hasBlockingError(findings)).toBe(false);

    const tooLong = "a".repeat(LIMITS.summary.max + 1);
    expect(
      hasBlockingError(validateText("summary", tooLong, LIMITS.summary))
    ).toBe(true);
  });

  test("the limit is applied to the trimmed value", () => {
    const padded = `  ${"a".repeat(160)}  `;
    expect(validateText("title", padded, LIMITS.title)).toEqual([]);
  });
});

describe("slugs", () => {
  test("accepts lowercase words joined by single hyphens", () => {
    for (const slug of ["abc", "a-b-c", "project-2", "123"]) {
      expect(validateSlug("slug", slug)).toEqual([]);
    }
  });

  test("refuses everything outside that shape", () => {
    for (const slug of [
      "Questurian",
      "with_underscore",
      "with space",
      "-leading",
      "trailing-",
      "double--hyphen",
      "ünicode",
      "with.dot",
    ]) {
      expect(codes(validateSlug("slug", slug))).toContain("malformed_slug");
    }
  });

  test("enforces the length bounds", () => {
    expect(codes(validateSlug("slug", "ab"))).toContain("too_short");
    expect(codes(validateSlug("slug", "a".repeat(81)))).toContain("too_long");
  });

  test("refuses words that would shadow a system route", () => {
    for (const slug of ["new", "edit", "admin", "api", "feed", "projects"]) {
      expect(codes(validateSlug("slug", slug))).toContain("reserved_slug");
    }
  });

  test("derives a candidate from a title", () => {
    expect(slugFromTitle("Who Is Alan Malpartida — Software Engineer")).toBe(
      "who-is-alan-malpartida-software-engineer"
    );
    expect(slugFromTitle("  Minimal Portfolio  ")).toBe("minimal-portfolio");
  });

  test("folds accents rather than dropping the letter", () => {
    expect(slugFromTitle("Málaga Trip")).toBe("malaga-trip");
  });

  test("a derived candidate never ends in a hyphen after truncation", () => {
    const derived = slugFromTitle(`${"a".repeat(79)} bbbb`);
    expect(derived.endsWith("-")).toBe(false);
    expect(validateSlug("slug", derived)).toEqual([]);
  });

  test("suggests -2, -3 on collision", () => {
    expect(suggestAvailableSlug("questurian", new Set())).toBe("questurian");
    expect(suggestAvailableSlug("questurian", new Set(["questurian"]))).toBe(
      "questurian-2"
    );
    expect(
      suggestAvailableSlug(
        "questurian",
        new Set(["questurian", "questurian-2"])
      )
    ).toBe("questurian-3");
  });

  test("keeps a collision suggestion inside the slug limit", () => {
    const occupied = "a".repeat(80);
    const suggestion = suggestAvailableSlug(occupied, new Set([occupied]));

    expect(suggestion).toBe(`${"a".repeat(78)}-2`);
    expect(validateSlug("slug", suggestion)).toEqual([]);
  });

  test("suggestion also steps around reserved words", () => {
    expect(suggestAvailableSlug("api", new Set())).toBe("api-2");
  });
});

describe("structured URL fields", () => {
  test("requires HTTPS", () => {
    expect(codes(validateHttpsUrl("url", "http://example.com"))).toEqual([
      "insecure_url",
    ]);
  });

  test("refuses embedded credentials", () => {
    // Renders as `example.com` in some UI and navigates somewhere else.
    expect(
      codes(validateHttpsUrl("url", "https://user:pass@example.com"))
    ).toEqual(["credentials_in_url"]);
  });

  test("refuses schemes that are not the web", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "//example.com",
      "/relative/path",
      "not a url",
    ]) {
      expect(hasBlockingError(validateHttpsUrl("url", url))).toBe(true);
    }
  });

  test("enforces the length limit", () => {
    const long = `https://example.com/${"a".repeat(LIMITS.url.max)}`;
    expect(codes(validateHttpsUrl("url", long))).toEqual(["too_long"]);
  });
});

describe("Markdown link targets", () => {
  test("allows the four shapes prose needs", () => {
    for (const target of [
      "https://example.com/page",
      "/projects",
      "/blog/some-post#section",
      "#heading",
      "mailto:alanmalpartida@gmail.com",
    ]) {
      expect(validateMarkdownLinkTarget("href", target)).toEqual([]);
    }
  });

  test("refuses everything else", () => {
    for (const target of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://example.com",
      "//evil.test/path",
      "https://user:pass@example.com",
    ]) {
      expect(hasBlockingError(validateMarkdownLinkTarget("href", target))).toBe(
        true
      );
    }
  });

  test("a mailto with a broken address is refused", () => {
    expect(
      hasBlockingError(
        validateMarkdownLinkTarget("href", "mailto:not-an-email")
      )
    ).toBe(true);
  });
});

describe("email", () => {
  test("accepts ordinary addresses", () => {
    for (const email of [
      "alanmalpartida@gmail.com",
      "a.b+tag@sub.example.co.uk",
    ]) {
      expect(validateEmail("email", email)).toEqual([]);
    }
  });

  test("refuses malformed ones", () => {
    for (const email of [
      "no-at-sign",
      "@example.com",
      "a@b",
      "a b@c.com",
      "a@",
    ]) {
      expect(codes(validateEmail("email", email))).toEqual(["invalid_email"]);
    }
  });
});

describe("publication dates", () => {
  const today = new Date("2026-07-31T12:00:00.000Z");

  test("requires YYYY-MM-DD", () => {
    for (const value of [
      "11-02-2026",
      "2026/02/11",
      "Feb 11 2026",
      "2026-2-1",
    ]) {
      expect(codes(validatePublicationDate("date", value, today))).toEqual([
        "invalid_date",
      ]);
    }
  });

  test("refuses a date that does not exist", () => {
    // `Date` would roll this into March rather than complaining.
    expect(codes(validatePublicationDate("date", "2026-02-31", today))).toEqual(
      ["invalid_date"]
    );
  });

  test("accepts today", () => {
    expect(validatePublicationDate("date", "2026-07-31", today)).toEqual([]);
  });

  test("refuses tomorrow, because there is no scheduler", () => {
    expect(codes(validatePublicationDate("date", "2026-08-01", today))).toEqual(
      ["future_publication_date"]
    );
  });
});

describe("view counts", () => {
  test("accepts non-negative integers", () => {
    for (const value of [0, 4, 1_000_000]) {
      expect(validateViewCount("views", value)).toEqual([]);
    }
  });

  test("refuses anything that is not one", () => {
    for (const value of [-1, 1.5, NaN, Infinity, "4", null, undefined]) {
      expect(hasBlockingError(validateViewCount("views", value))).toBe(true);
    }
  });
});

describe("SEO overrides", () => {
  test("absent overrides produce nothing, so fallbacks stay in charge", () => {
    // #36 requires the import to seed these as null precisely so today's
    // metadata keeps coming from the existing logic.
    expect(validateSeoOverrides({})).toEqual([]);
    expect(validateSeoOverrides({ title: null, description: null })).toEqual(
      []
    );
    expect(validateSeoOverrides({ title: "  ", description: "  " })).toEqual(
      []
    );
  });

  test("a description outside the preferred window warns but does not block", () => {
    const findings = validateSeoOverrides({ description: "short" });

    expect(codes(findings)).toContain("outside_recommended_length");
    expect(hasBlockingError(findings)).toBe(false);
  });

  test("a description inside the preferred window is clean", () => {
    expect(validateSeoOverrides({ description: "a".repeat(100) })).toEqual([]);
  });

  test("an over-limit title blocks", () => {
    expect(
      hasBlockingError(
        validateSeoOverrides({ title: "a".repeat(LIMITS.seoTitle.max + 1) })
      )
    ).toBe(true);
  });
});
