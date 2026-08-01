/**
 * The shape of every editable thing, and the rule that nothing else is stored.
 *
 * #32 is explicit that content storage rejects unknown fields rather than
 * silently retaining arbitrary JSON. That is what `parseContentData` is for:
 * it is not a type assertion, it is a gate. Anything the schema does not name
 * is refused, so a field cannot arrive through a future API bug, sit unnoticed
 * in a stored snapshot, and reappear in a renderer that trusts it.
 *
 * Each stored snapshot carries `schema_version`. An unknown version fails
 * closed — a release that meets content it does not understand must refuse to
 * render it rather than guess, because guessing means publishing something
 * nobody wrote.
 *
 * Fields that address the content rather than describing it — slug, display
 * order, publication date — are table columns, not members of this JSON. They
 * need uniqueness constraints, ordering, and indexes, none of which SQLite can
 * give a value buried in a blob.
 */

import {
  LIMITS,
  hasBlockingError,
  normalizeAccentColor,
  normalizeText,
  validateAccentColor,
  validateCount,
  validateEmail,
  validateHttpsUrl,
  validateSeoOverrides,
  validateText,
  type Finding,
  type ValidationMode,
} from "./validation";
import type { ContentType } from "./identity";

/**
 * Bumped only when a stored shape changes incompatibly.
 *
 * Adding an optional field does not need a bump; removing one, renaming one, or
 * changing what a value means does.
 */
export const CONTENT_SCHEMA_VERSION = 1;

/**
 * A reference to an image.
 *
 * The alt text lives beside the reference rather than on the Media asset,
 * because the same photograph means different things in different places and
 * the description belongs to the usage. The delivery URL is deliberately absent:
 * it is built at render time from the closed variant enum.
 */
export interface MediaReference {
  mediaAssetId: string;
  alt: string;
}

export interface SeoOverrides {
  title: string | null;
  description: string | null;
  sharingImage: MediaReference | null;
}

export interface HomeContent {
  displayName: string;
  email: string;
  githubUsername: string;
  professionalTitle: string;
  introMarkdown: string;
  bioMarkdown: string;
  portrait: MediaReference | null;
  seo: SeoOverrides;
}

export interface SocialLink {
  label: string;
  url: string;
}

export interface AboutContent {
  introMarkdown: string;
  hobbiesMarkdown: string;
  socialLinks: SocialLink[];
  featuredTitle: string;
  featuredBodyMarkdown: string;
  seo: SeoOverrides;
}

export interface BrandingContent {
  logo: MediaReference | null;
  defaultSharingImage: MediaReference | null;
}

export interface ProjectContent {
  title: string;
  summary: string;
  card: MediaReference | null;
  kicker: string;
  role: string;
  status: string;
  period: string;
  technologies: string[];
  liveUrl: string | null;
  repositoryUrl: string | null;
  accentColor: string;
  bodyMarkdown: string;
  seo: SeoOverrides;
}

export interface BlogPostContent {
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  sharingImage: MediaReference | null;
  seo: SeoOverrides;
}

export type ContentData =
  | HomeContent
  | AboutContent
  | BrandingContent
  | ProjectContent
  | BlogPostContent;

/** The fields each type may carry. Anything else is refused. */
const ALLOWED_FIELDS: Record<ContentType, readonly string[]> = {
  home: [
    "displayName",
    "email",
    "githubUsername",
    "professionalTitle",
    "introMarkdown",
    "bioMarkdown",
    "portrait",
    "seo",
  ],
  about: [
    "introMarkdown",
    "hobbiesMarkdown",
    "socialLinks",
    "featuredTitle",
    "featuredBodyMarkdown",
    "seo",
  ],
  branding: ["logo", "defaultSharingImage"],
  project: [
    "title",
    "summary",
    "card",
    "kicker",
    "role",
    "status",
    "period",
    "technologies",
    "liveUrl",
    "repositoryUrl",
    "accentColor",
    "bodyMarkdown",
    "seo",
  ],
  blog_post: ["title", "excerpt", "bodyMarkdown", "sharingImage", "seo"],
};

function error(field: string, code: string): Finding {
  return { field, code, severity: "error" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Refuses fields the schema does not name.
 *
 * Checked before anything is read, so an unexpected key is reported as itself
 * rather than as a downstream type error.
 */
function rejectUnknownFields(
  type: ContentType,
  raw: Record<string, unknown>
): Finding[] {
  const allowed = new Set(ALLOWED_FIELDS[type]);

  return Object.keys(raw)
    .filter((key) => !allowed.has(key))
    .map((key) => error(key, "unknown_field"));
}

function readString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  return typeof value === "string" ? value : "";
}

function readOptionalString(
  raw: Record<string, unknown>,
  field: string
): string | null {
  const value = raw[field];
  if (value == null) return null;
  return typeof value === "string" ? normalizeText(value) || null : null;
}

function readStringArray(
  raw: Record<string, unknown>,
  field: string
): { values: string[]; findings: Finding[] } {
  const value = raw[field];

  if (value === undefined) return { values: [], findings: [] };

  if (!Array.isArray(value)) {
    return { values: [], findings: [error(field, "expected_array")] };
  }

  if (!value.every((entry) => typeof entry === "string")) {
    return { values: [], findings: [error(field, "expected_string_entries")] };
  }

  return {
    values: (value as string[]).map(normalizeText).filter((v) => v !== ""),
    findings: [],
  };
}

function parseMediaReference(
  field: string,
  value: unknown,
  mode: ValidationMode
): { reference: MediaReference | null; findings: Finding[] } {
  if (value == null) return { reference: null, findings: [] };

  if (!isPlainObject(value)) {
    return { reference: null, findings: [error(field, "expected_object")] };
  }

  const unknown = Object.keys(value)
    .filter((key) => key !== "mediaAssetId" && key !== "alt")
    .map((key) => error(`${field}.${key}`, "unknown_field"));

  const mediaAssetId = normalizeText(
    typeof value.mediaAssetId === "string" ? value.mediaAssetId : ""
  );
  const alt = typeof value.alt === "string" ? normalizeText(value.alt) : "";

  const findings: Finding[] = [...unknown];

  if (mediaAssetId === "") {
    findings.push(error(`${field}.mediaAssetId`, "required"));
  }

  // Alt text is required at publish for a meaningful image. It is not required
  // in a draft, because an Owner who has just picked a photograph should not be
  // blocked from saving before describing it.
  if (alt === "" && mode === "publish") {
    findings.push(error(`${field}.alt`, "alt_text_required"));
  }

  findings.push(
    ...validateText(`${field}.alt`, alt, { max: LIMITS.title.max })
  );

  return { reference: { mediaAssetId, alt }, findings };
}

function parseSeo(
  value: unknown,
  mode: ValidationMode
): { seo: SeoOverrides; findings: Finding[] } {
  if (value == null) {
    return {
      seo: { title: null, description: null, sharingImage: null },
      findings: [],
    };
  }

  if (!isPlainObject(value)) {
    return {
      seo: { title: null, description: null, sharingImage: null },
      findings: [error("seo", "expected_object")],
    };
  }

  const unknown = Object.keys(value)
    .filter(
      (key) =>
        key !== "title" && key !== "description" && key !== "sharingImage"
    )
    .map((key) => error(`seo.${key}`, "unknown_field"));

  const title = readOptionalString(value, "title");
  const description = readOptionalString(value, "description");
  const sharing = parseMediaReference(
    "seo.sharingImage",
    value.sharingImage,
    mode
  );

  return {
    seo: { title, description, sharingImage: sharing.reference },
    findings: [
      ...unknown,
      ...sharing.findings,
      ...validateSeoOverrides({ title, description }),
    ],
  };
}

export interface ParsedContent {
  data: ContentData;
  findings: Finding[];
}

/**
 * Turns untrusted JSON into a typed, validated snapshot.
 *
 * Returns both the data and the findings rather than throwing, because a draft
 * with findings is still a draft worth storing — the caller decides whether the
 * findings block, using `hasBlockingError`.
 */
export function parseContentData(
  type: ContentType,
  raw: unknown,
  mode: ValidationMode = "draft"
): ParsedContent {
  if (!isPlainObject(raw)) {
    throw new Error("Content data must be an object");
  }

  const findings: Finding[] = rejectUnknownFields(type, raw);
  const required = mode === "publish";

  switch (type) {
    case "home":
      return parseHome(raw, mode, required, findings);
    case "about":
      return parseAbout(raw, mode, required, findings);
    case "branding":
      return parseBranding(raw, mode, findings);
    case "project":
      return parseProject(raw, mode, required, findings);
    case "blog_post":
      return parseBlogPost(raw, mode, required, findings);
  }
}

function parseHome(
  raw: Record<string, unknown>,
  mode: ValidationMode,
  required: boolean,
  findings: Finding[]
): ParsedContent {
  const displayName = normalizeText(readString(raw, "displayName"));
  const email = normalizeText(readString(raw, "email"));
  const githubUsername = normalizeText(readString(raw, "githubUsername"));
  const professionalTitle = normalizeText(readString(raw, "professionalTitle"));
  const introMarkdown = normalizeText(readString(raw, "introMarkdown"));
  const bioMarkdown = normalizeText(readString(raw, "bioMarkdown"));

  const portrait = parseMediaReference("portrait", raw.portrait, mode);
  const seo = parseSeo(raw.seo, mode);

  findings.push(
    ...validateText("displayName", displayName, LIMITS.title, { required }),
    ...validateText("professionalTitle", professionalTitle, LIMITS.label, {
      required,
    }),
    ...validateText("githubUsername", githubUsername, LIMITS.label, {
      required,
    }),
    ...validateText(
      "introMarkdown",
      introMarkdown,
      { max: LIMITS.shortMarkdown.max, kind: "block" },
      { required }
    ),
    ...validateText(
      "bioMarkdown",
      bioMarkdown,
      { max: LIMITS.shortMarkdown.max, kind: "block" },
      { required }
    ),
    ...portrait.findings,
    ...seo.findings
  );

  if (email !== "" || required) {
    findings.push(...validateEmail("email", email));
  }

  return {
    data: {
      displayName,
      email,
      githubUsername,
      professionalTitle,
      introMarkdown,
      bioMarkdown,
      portrait: portrait.reference,
      seo: seo.seo,
    },
    findings,
  };
}

function parseAbout(
  raw: Record<string, unknown>,
  mode: ValidationMode,
  required: boolean,
  findings: Finding[]
): ParsedContent {
  const introMarkdown = normalizeText(readString(raw, "introMarkdown"));
  const hobbiesMarkdown = normalizeText(readString(raw, "hobbiesMarkdown"));
  const featuredTitle = normalizeText(readString(raw, "featuredTitle"));
  const featuredBodyMarkdown = normalizeText(
    readString(raw, "featuredBodyMarkdown")
  );

  const socialLinks: SocialLink[] = [];
  const rawLinks = raw.socialLinks;

  if (rawLinks !== undefined) {
    if (!Array.isArray(rawLinks)) {
      findings.push(error("socialLinks", "expected_array"));
    } else {
      findings.push(
        ...validateCount("socialLinks", rawLinks.length, LIMITS.socialLinks.max)
      );

      rawLinks.forEach((entry, index) => {
        const field = `socialLinks[${index}]`;

        if (!isPlainObject(entry)) {
          findings.push(error(field, "expected_object"));
          return;
        }

        findings.push(
          ...Object.keys(entry)
            .filter((key) => key !== "label" && key !== "url")
            .map((key) => error(`${field}.${key}`, "unknown_field"))
        );

        const label = normalizeText(
          typeof entry.label === "string" ? entry.label : ""
        );
        const url = normalizeText(
          typeof entry.url === "string" ? entry.url : ""
        );

        findings.push(
          ...validateText(`${field}.label`, label, LIMITS.label, {
            required: true,
          }),
          ...validateHttpsUrl(`${field}.url`, url)
        );

        socialLinks.push({ label, url });
      });
    }
  }

  const seo = parseSeo(raw.seo, mode);

  findings.push(
    ...validateText(
      "introMarkdown",
      introMarkdown,
      { max: LIMITS.shortMarkdown.max, kind: "block" },
      { required }
    ),
    ...validateText(
      "hobbiesMarkdown",
      hobbiesMarkdown,
      { max: LIMITS.shortMarkdown.max, kind: "block" },
      { required }
    ),
    ...validateText("featuredTitle", featuredTitle, LIMITS.title, { required }),
    ...validateText(
      "featuredBodyMarkdown",
      featuredBodyMarkdown,
      { max: LIMITS.shortMarkdown.max, kind: "block" },
      { required }
    ),
    ...seo.findings
  );

  return {
    data: {
      introMarkdown,
      hobbiesMarkdown,
      socialLinks,
      featuredTitle,
      featuredBodyMarkdown,
      seo: seo.seo,
    },
    findings,
  };
}

function parseBranding(
  raw: Record<string, unknown>,
  mode: ValidationMode,
  findings: Finding[]
): ParsedContent {
  const logo = parseMediaReference("logo", raw.logo, mode);
  const sharing = parseMediaReference(
    "defaultSharingImage",
    raw.defaultSharingImage,
    mode
  );

  findings.push(...logo.findings, ...sharing.findings);

  return {
    data: {
      logo: logo.reference,
      defaultSharingImage: sharing.reference,
    },
    findings,
  };
}

function parseProject(
  raw: Record<string, unknown>,
  mode: ValidationMode,
  required: boolean,
  findings: Finding[]
): ParsedContent {
  const title = normalizeText(readString(raw, "title"));
  const summary = normalizeText(readString(raw, "summary"));
  const kicker = normalizeText(readString(raw, "kicker"));
  const role = normalizeText(readString(raw, "role"));
  const status = normalizeText(readString(raw, "status"));
  const period = normalizeText(readString(raw, "period"));
  const bodyMarkdown = normalizeText(readString(raw, "bodyMarkdown"));
  const accentColor = normalizeAccentColor(readString(raw, "accentColor"));

  const technologies = readStringArray(raw, "technologies");
  const card = parseMediaReference("card", raw.card, mode);
  const seo = parseSeo(raw.seo, mode);

  const liveUrl = readOptionalString(raw, "liveUrl");
  const repositoryUrl = readOptionalString(raw, "repositoryUrl");

  findings.push(
    ...validateText("title", title, LIMITS.title, { required }),
    ...validateText("summary", summary, LIMITS.summary, { required }),
    ...validateText("kicker", kicker, LIMITS.label, { required }),
    ...validateText("role", role, LIMITS.label, { required }),
    ...validateText("status", status, LIMITS.label, { required }),
    ...validateText("period", period, LIMITS.label, { required }),
    ...validateText(
      "bodyMarkdown",
      bodyMarkdown,
      { max: LIMITS.bodyMarkdown.max, kind: "block" },
      { required }
    ),
    ...technologies.findings,
    ...validateCount(
      "technologies",
      technologies.values.length,
      LIMITS.technologies.max
    ),
    ...card.findings,
    ...seo.findings
  );

  technologies.values.forEach((entry, index) => {
    findings.push(
      ...validateText(`technologies[${index}]`, entry, LIMITS.label, {
        required: true,
      })
    );
  });

  if (accentColor !== "" || required) {
    findings.push(...validateAccentColor("accentColor", accentColor));
  }

  if (liveUrl !== null) {
    findings.push(...validateHttpsUrl("liveUrl", liveUrl));
  }

  if (repositoryUrl !== null) {
    findings.push(...validateHttpsUrl("repositoryUrl", repositoryUrl));
  }

  return {
    data: {
      title,
      summary,
      card: card.reference,
      kicker,
      role,
      status,
      period,
      technologies: technologies.values,
      liveUrl,
      repositoryUrl,
      accentColor,
      bodyMarkdown,
      seo: seo.seo,
    },
    findings,
  };
}

function parseBlogPost(
  raw: Record<string, unknown>,
  mode: ValidationMode,
  required: boolean,
  findings: Finding[]
): ParsedContent {
  const title = normalizeText(readString(raw, "title"));
  const excerpt = normalizeText(readString(raw, "excerpt"));
  const bodyMarkdown = normalizeText(readString(raw, "bodyMarkdown"));

  const sharingImage = parseMediaReference(
    "sharingImage",
    raw.sharingImage,
    mode
  );
  const seo = parseSeo(raw.seo, mode);

  findings.push(
    ...validateText("title", title, LIMITS.title, { required }),
    ...validateText("excerpt", excerpt, LIMITS.summary, { required }),
    ...validateText(
      "bodyMarkdown",
      bodyMarkdown,
      { max: LIMITS.bodyMarkdown.max, kind: "block" },
      { required }
    ),
    ...sharingImage.findings,
    ...seo.findings
  );

  return {
    data: {
      title,
      excerpt,
      bodyMarkdown,
      sharingImage: sharingImage.reference,
      seo: seo.seo,
    },
    findings,
  };
}

/** Convenience for callers that only need a yes or no. */
export function isPublishable(type: ContentType, raw: unknown): boolean {
  return !hasBlockingError(parseContentData(type, raw, "publish").findings);
}
