/**
 * What makes a piece of content acceptable.
 *
 * The rules are #32's, transcribed rather than invented. What this module adds
 * is the *shape* of an answer: a list of findings, each naming a field and a
 * machine-readable code, with a severity that decides whether the content can
 * move.
 *
 * Two distinctions drive everything here.
 *
 * **Draft versus publish.** A draft is work in progress, so a missing title is
 * not an error — losing the Owner's half-finished paragraph because they had
 * not named it yet would be worse than storing it. But nothing unsafe or
 * oversized is ever stored, in either mode, because those are the properties
 * that make storage itself dangerous. Publish then runs the full check
 * atomically, so incomplete content cannot reach the public site.
 *
 * **Error versus warning.** Errors are objective and blocking: a malformed
 * slug, an unsafe link, a value past a hard limit. Warnings are editorial
 * judgement — an SEO description outside the length search engines prefer — and
 * must never block, because the Owner is the editor and this module is not.
 *
 * Markdown *content* rules live in the restricted-Markdown boundary, not here;
 * this module validates the fields around them, including their size.
 */

/** Hard limits, from #32's table. Bytes are not the unit — characters are. */
export const LIMITS = {
  title: { min: 1, max: 160 },
  label: { min: 1, max: 80 },
  summary: { max: 500, warnAfter: 320 },
  shortMarkdown: { max: 10_000 },
  bodyMarkdown: { max: 250_000 },
  url: { max: 2_048 },
  seoTitle: { max: 100, warnAfter: 60 },
  seoDescription: { max: 500, warnPreferred: { min: 70, max: 160 } },
  socialLinks: { max: 8 },
  technologies: { max: 20 },
  slug: { min: 3, max: 80 },
} as const;

export type Severity = "error" | "warning";

export interface Finding {
  field: string;
  code: string;
  severity: Severity;
}

export type ValidationMode = "draft" | "publish";

function error(field: string, code: string): Finding {
  return { field, code, severity: "error" };
}

function warning(field: string, code: string): Finding {
  return { field, code, severity: "warning" };
}

export function hasBlockingError(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}

/**
 * Counts what a reader would call characters.
 *
 * `String.length` counts UTF-16 code units, so an emoji costs two and an
 * astral-plane character silently halves the real limit. Spreading the string
 * iterates code points instead. Not grapheme clusters — that needs a segmenter
 * and the difference does not matter at these limits.
 */
export function characterLength(value: string): number {
  return [...value].length;
}

/**
 * Control characters that never belong in content.
 *
 * C0 and C1 minus the whitespace a text block legitimately contains. These are
 * excluded because they are invisible: they survive review, and they can change
 * how a value is interpreted downstream without changing how it looks.
 *
 * A text block keeps tab, newline, and carriage return.
 */
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/**
 * A single-line field: the same, plus the line breaks themselves. A newline in
 * a title is not content, it is a value that will render somewhere unexpected.
 */
const CONTROL_CHARACTERS_SINGLE_LINE = /[\u0000-\u001F\u007F-\u009F]/;

export type TextKind = "line" | "block";

/**
 * Trims the edges and leaves the inside alone.
 *
 * #32 asks for exactly this: surrounding whitespace is accidental, internal
 * whitespace is the author's. Unicode is preserved as written — no case
 * folding, no normalisation — because normalising someone's name is a content
 * change nobody asked for.
 */
export function normalizeText(value: string): string {
  return value.trim();
}

export interface TextRule {
  min?: number;
  max: number;
  warnAfter?: number;
  kind?: TextKind;
}

/**
 * The common path for every free-text field.
 *
 * `required` is the mode's job, not the rule's: the same field is optional in a
 * draft and mandatory at publish, and threading that through here keeps the
 * two modes from drifting apart.
 */
export function validateText(
  field: string,
  value: string,
  rule: TextRule,
  options: { required: boolean } = { required: false }
): Finding[] {
  const findings: Finding[] = [];
  const normalized = normalizeText(value);
  const length = characterLength(normalized);

  if (length === 0) {
    // Absent is not malformed. Only the caller knows whether it is time to
    // insist on this field.
    return options.required ? [error(field, "required")] : [];
  }

  const pattern =
    (rule.kind ?? "line") === "block"
      ? CONTROL_CHARACTERS
      : CONTROL_CHARACTERS_SINGLE_LINE;

  if (pattern.test(normalized)) {
    findings.push(error(field, "control_characters"));
  }

  if (rule.min !== undefined && length < rule.min) {
    findings.push(error(field, "too_short"));
  }

  if (length > rule.max) {
    findings.push(error(field, "too_long"));
  }

  if (rule.warnAfter !== undefined && length > rule.warnAfter) {
    findings.push(warning(field, "longer_than_recommended"));
  }

  return findings;
}

/**
 * Slug rules, and the reason they are strict.
 *
 * A slug is a public URL segment, so it is the one content field that becomes
 * part of the site's addressing. Anything outside lowercase ASCII and single
 * hyphens invites percent-encoding, homograph confusion, and case-sensitivity
 * bugs between the router and the database.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Words a slug may not take.
 *
 * The first five are #32's. The rest are this application's own top-level
 * routes: a slug is only safe if it cannot shadow a route the router already
 * owns, and that list is knowable rather than guessable.
 */
export const RESERVED_SLUGS = new Set([
  "new",
  "edit",
  "admin",
  "api",
  "feed",
  "home",
  "about",
  "blog",
  "projects",
  "healthz",
  "readyz",
  "robots.txt",
  "sitemap.xml",
]);

export function validateSlug(field: string, value: string): Finding[] {
  const findings: Finding[] = [];
  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return [error(field, "required")];
  }

  if (!SLUG_PATTERN.test(normalized)) {
    // Covers uppercase, underscores, spaces, non-ASCII, and leading, trailing,
    // or repeated hyphens in one check.
    findings.push(error(field, "malformed_slug"));
  }

  if (characterLength(normalized) < LIMITS.slug.min) {
    findings.push(error(field, "too_short"));
  }

  if (characterLength(normalized) > LIMITS.slug.max) {
    findings.push(error(field, "too_long"));
  }

  if (RESERVED_SLUGS.has(normalized)) {
    findings.push(error(field, "reserved_slug"));
  }

  return findings;
}

/**
 * Derives a slug candidate from a title.
 *
 * A suggestion only. #32 is explicit that a title edit never silently changes a
 * published slug, so nothing calls this except slug *creation* and the
 * collision suggestion path.
 */
export function slugFromTitle(title: string): string {
  return (
    normalizeText(title)
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks so "Málaga" becomes "malaga" rather than losing the
      // whole letter.
      .replace(/[\u0300-\u036F]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, LIMITS.slug.max)
      .replace(/-+$/g, "")
  );
}

/**
 * Suggests the next free slug in a collection.
 *
 * `-2`, `-3`, as #32 specifies. The Owner still confirms before first
 * publication; this only avoids handing them a name that is already taken.
 */
export function suggestAvailableSlug(
  candidate: string,
  taken: ReadonlySet<string>
): string {
  if (!taken.has(candidate) && !RESERVED_SLUGS.has(candidate)) {
    return candidate;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const ending = `-${suffix}`;
    const base = candidate
      .slice(0, LIMITS.slug.max - ending.length)
      .replace(/-+$/g, "");
    const next = `${base}${ending}`;
    if (!taken.has(next) && !RESERVED_SLUGS.has(next)) {
      return next;
    }
  }

  throw new Error("Could not find an available slug");
}

/**
 * Structured URL fields: repository, live site, social links.
 *
 * HTTPS and nothing else. These render as links the visitor clicks, and every
 * rejected scheme here is one that either downgrades the connection or executes
 * in this origin.
 */
export function validateHttpsUrl(field: string, value: string): Finding[] {
  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return [error(field, "required")];
  }

  if (characterLength(normalized) > LIMITS.url.max) {
    return [error(field, "too_long")];
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return [error(field, "malformed_url")];
  }

  if (url.protocol !== "https:") {
    return [error(field, "insecure_url")];
  }

  // `https://user:pass@host` renders as `host` in some UI and navigates
  // somewhere else. Refused outright rather than stripped.
  if (url.username !== "" || url.password !== "") {
    return [error(field, "credentials_in_url")];
  }

  if (url.hostname === "") {
    return [error(field, "malformed_url")];
  }

  return [];
}

/**
 * Link targets permitted inside Markdown bodies.
 *
 * Wider than the structured fields, because prose legitimately links to other
 * pages on this site, to headings within a page, and to an email address. It is
 * still an allowlist: anything that is not one of those four shapes is refused,
 * so a new scheme cannot become permitted by being unanticipated.
 *
 * Lives here rather than in the Markdown boundary so that both the parser and
 * the structured fields answer to one policy.
 */
export function validateMarkdownLinkTarget(
  field: string,
  value: string
): Finding[] {
  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return [error(field, "required")];
  }

  if (characterLength(normalized) > LIMITS.url.max) {
    return [error(field, "too_long")];
  }

  // Checked before parsing: `//evil.test` is a valid URL reference that
  // inherits the page's scheme and goes somewhere else entirely.
  if (normalized.startsWith("//")) {
    return [error(field, "protocol_relative_url")];
  }

  // Site-relative paths and fragments carry no scheme and stay on this origin.
  if (normalized.startsWith("/") || normalized.startsWith("#")) {
    return [];
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return [error(field, "malformed_url")];
  }

  if (url.protocol === "mailto:") {
    return validateEmail(field, url.pathname);
  }

  if (url.protocol !== "https:") {
    // `javascript:`, `data:`, `file:`, and plain `http:` all land here.
    return [error(field, "disallowed_url_scheme")];
  }

  if (url.username !== "" || url.password !== "") {
    return [error(field, "credentials_in_url")];
  }

  return [];
}

/**
 * Email validation, kept deliberately shallow.
 *
 * "Syntactically valid" per #32. A stricter pattern rejects addresses that
 * genuinely work, and the only consumer is a `mailto:` link the Owner typed
 * about themselves — there is no security decision resting on this.
 */
const EMAIL_PATTERN =
  /^[^\s@,;:<>"()[\]\\]+@[^\s@.,;:<>"()[\]\\]+(?:\.[^\s@.,;:<>"()[\]\\]+)+$/;

export function validateEmail(field: string, value: string): Finding[] {
  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return [error(field, "required")];
  }

  return EMAIL_PATTERN.test(normalized) ? [] : [error(field, "invalid_email")];
}

const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Lowercased so two spellings of one colour compare equal. */
export function normalizeAccentColor(value: string): string {
  return normalizeText(value).toLowerCase();
}

export function validateAccentColor(field: string, value: string): Finding[] {
  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return [error(field, "required")];
  }

  // Six digits only: shorthand and alpha channels are extra shapes to render,
  // compare, and migrate for no editorial gain.
  return ACCENT_PATTERN.test(normalized)
    ? []
    : [error(field, "invalid_accent_color")];
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Publication dates.
 *
 * `YYYY-MM-DD`, and never in the future. #32 rules out anything that implies
 * scheduled publishing: a future date would be a promise this system has no
 * scheduler to keep, and the post would sit published with a date that has not
 * happened.
 *
 * `today` is a parameter so this is testable without freezing the clock.
 */
export function validatePublicationDate(
  field: string,
  value: string,
  today: Date = new Date()
): Finding[] {
  const normalized = normalizeText(value);

  if (normalized.length === 0) {
    return [error(field, "required")];
  }

  const match = DATE_PATTERN.exec(normalized);
  if (!match) {
    return [error(field, "invalid_date")];
  }

  const [, year, month, day] = match;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return [error(field, "invalid_date")];
  }

  // Round-tripped so that 2026-02-31 is rejected rather than silently rolling
  // forward into March, which is what `Date` does on its own.
  const roundTrip = parsed.toISOString().slice(0, 10);
  if (roundTrip !== `${year}-${month}-${day}`) {
    return [error(field, "invalid_date")];
  }

  const todayUtc = today.toISOString().slice(0, 10);
  if (normalized > todayUtc) {
    return [error(field, "future_publication_date")];
  }

  return [];
}

export function validateCount(
  field: string,
  count: number,
  max: number
): Finding[] {
  return count > max ? [error(field, "too_many")] : [];
}

/**
 * View counts, which are the one imported value that is a quantity.
 *
 * #36 requires the exact non-negative integer to survive. A fractional or
 * negative count means the source file was corrupted or hand-edited, and
 * guessing a replacement would quietly lose real data.
 */
export function validateViewCount(field: string, value: unknown): Finding[] {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return [error(field, "invalid_view_count")];
  }

  return value < 0 ? [error(field, "negative_view_count")] : [];
}

/**
 * SEO overrides, which are optional everywhere.
 *
 * Absent means "use the established fallback", and #36 requires the import to
 * seed these as null precisely so today's title, description, canonical, Open
 * Graph, Twitter, and JSON-LD output keeps coming from the existing logic.
 */
export function validateSeoOverrides(
  overrides: { title?: string | null; description?: string | null },
  fieldPrefix = "seo"
): Finding[] {
  const findings: Finding[] = [];

  if (overrides.title != null && normalizeText(overrides.title) !== "") {
    findings.push(
      ...validateText(`${fieldPrefix}.title`, overrides.title, {
        max: LIMITS.seoTitle.max,
        warnAfter: LIMITS.seoTitle.warnAfter,
      })
    );
  }

  if (
    overrides.description != null &&
    normalizeText(overrides.description) !== ""
  ) {
    const description = normalizeText(overrides.description);
    findings.push(
      ...validateText(`${fieldPrefix}.description`, description, {
        max: LIMITS.seoDescription.max,
      })
    );

    const length = characterLength(description);
    const preferred = LIMITS.seoDescription.warnPreferred;
    if (length < preferred.min || length > preferred.max) {
      findings.push(
        warning(`${fieldPrefix}.description`, "outside_recommended_length")
      );
    }
  }

  return findings;
}
