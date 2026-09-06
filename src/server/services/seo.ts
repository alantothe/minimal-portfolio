import { aboutConfig, homeConfig } from "../../config";

export type SeoPageInput =
  | { kind: "home" }
  | { kind: "about" }
  | { kind: "blog"; page: number }
  | { kind: "projects"; page: number }
  | {
      kind: "blog-post";
      slug: string;
      title: string;
      description: string;
      date: string | Date;
    }
  | {
      kind: "project";
      slug: string;
      title: string;
      description: string;
    };

export interface SeoMetadata {
  siteName: string;
  title: string;
  description: string;
  canonical: string;
  type: "website" | "article";
  image: string;
  favicon: string;
  publishedTime?: string;
  structuredData?: Record<string, unknown>;
}

function parseConfiguredOrigin(): string | null {
  const configuredUrl = process.env.SITE_URL?.trim();
  if (!configuredUrl) {
    return null;
  }

  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    // The error below gives one consistent configuration message.
  }

  throw new Error("SITE_URL must be an absolute HTTP(S) URL");
}

export function validateProductionSiteUrl(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const origin = parseConfiguredOrigin();
  if (!origin) {
    throw new Error("SITE_URL is required in production");
  }

  const url = new URL(origin);
  if (url.protocol !== "https:" || url.hostname === "example.com") {
    throw new Error(
      "SITE_URL must be the final public HTTPS origin in production"
    );
  }
}

function getSiteOrigin(requestUrl: URL): string {
  validateProductionSiteUrl();
  return parseConfiguredOrigin() || requestUrl.origin;
}

function withPage(path: string, page?: number): string {
  return page && page > 1 ? `${path}?page=${page}` : path;
}

export function getCanonicalUrl(input: SeoPageInput, requestUrl: URL): string {
  const origin = getSiteOrigin(requestUrl);
  let path: string;

  switch (input.kind) {
    case "home":
      path = "/";
      break;
    case "about":
      path = "/about";
      break;
    case "blog":
      path = withPage("/blog", input.page);
      break;
    case "projects":
      path = withPage("/projects", input.page);
      break;
    case "blog-post":
      path = `/blog/${encodeURIComponent(input.slug)}`;
      break;
    case "project":
      path = `/projects/${encodeURIComponent(input.slug)}`;
      break;
  }

  return new URL(path, `${origin}/`).toString();
}

export function absoluteImageUrl(image: string, origin: string): string {
  return new URL(image, `${origin}/`).toString();
}

function identityId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "profile";
}

/**
 * Who the site is about, and which images represent it.
 *
 * Extracted so the database-backed renderer can supply the same four facts from
 * a published generation instead of from `src/config`. The *formulas* below —
 * every title pattern, description sentence, and JSON-LD shape — stay in one
 * place, because #36 seeds every SEO override as null precisely so these
 * fallbacks keep working, and two copies of them would drift apart silently.
 */
export interface SeoIdentity {
  siteName: string;
  role: string;
  /** Absolute URL of the default sharing image. */
  sharingImage: string;
  /** Absolute URL of the portrait used in the Person schema. */
  portraitImage: string;
  socialUrls: string[];
}

function configuredIdentity(origin: string): SeoIdentity {
  return {
    siteName: homeConfig.author.name,
    role: homeConfig.professional.title,
    sharingImage: absoluteImageUrl("/public/og.png", origin),
    portraitImage: absoluteImageUrl(homeConfig.author.photo, origin),
    socialUrls: aboutConfig.sections.personal.socialLinks.map(
      (link) => link.url
    ),
  };
}

function personSchema(origin: string, identity: SeoIdentity) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${origin}/#${identityId(identity.siteName)}`,
    name: identity.siteName,
    url: `${origin}/`,
    image: identity.portraitImage,
    jobTitle: identity.role,
    sameAs: identity.socialUrls,
  };
}

export function createSeoMetadata(
  input: SeoPageInput,
  requestUrl: URL
): SeoMetadata {
  const canonical = getCanonicalUrl(input, requestUrl);
  const origin = new URL(canonical).origin;

  return buildSeoMetadata(input, configuredIdentity(origin), canonical);
}

/**
 * The metadata for one page, given who the site is about.
 *
 * Takes a canonical URL rather than deriving one, so a caller that already
 * resolved a page's canonical route cannot end up with a `<link rel=canonical>`
 * that disagrees with the route it is serving.
 */
export function buildSeoMetadata(
  input: SeoPageInput,
  identity: SeoIdentity,
  canonical: string
): SeoMetadata {
  const origin = new URL(canonical).origin;
  const siteName = identity.siteName;
  const role = identity.role;
  const image = identity.sharingImage;
  const favicon = identity.portraitImage;
  const person = personSchema(origin, identity);

  switch (input.kind) {
    case "home":
      return {
        siteName,
        title: `${siteName} — ${role}`,
        description: `${siteName} is a full-stack software engineer working as ${role}, building web platforms and sharing technical projects.`,
        canonical,
        type: "website",
        image,
        favicon,
        structuredData: {
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          primaryImageOfPage: identity.portraitImage,
          mainEntity: person,
        },
      };
    case "about":
      return {
        siteName,
        title: `About ${siteName}`,
        description: `Learn about ${siteName}, their software engineering background, current work, and selected interests.`,
        canonical,
        type: "website",
        image,
        favicon,
        structuredData: {
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          primaryImageOfPage: identity.portraitImage,
          mainEntity: person,
        },
      };
    case "blog":
      return {
        siteName,
        title:
          input.page > 1
            ? `${siteName}’s Software Engineering Blog — Page ${input.page}`
            : `${siteName}’s Software Engineering Blog`,
        description: `Software engineering, architecture, startup building, and project notes from ${siteName}.`,
        canonical,
        type: "website",
        image,
        favicon,
      };
    case "projects":
      return {
        siteName,
        title:
          input.page > 1
            ? `Software Projects by ${siteName} — Page ${input.page}`
            : `Software Projects by ${siteName}`,
        description: `Selected software projects built and contributed to by ${siteName}, with implementation details and technical context.`,
        canonical,
        type: "website",
        image,
        favicon,
      };
    case "blog-post":
      const publishedTime =
        input.date instanceof Date ? input.date.toISOString() : input.date;
      return {
        siteName,
        title: `${input.title} | ${siteName}`,
        description: input.description,
        canonical,
        type: "article",
        image,
        favicon,
        publishedTime,
        structuredData: {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: input.title,
          description: input.description,
          datePublished: publishedTime,
          mainEntityOfPage: canonical,
          author: {
            "@id": person["@id"],
            "@type": "Person",
            name: person.name,
            url: person.url,
          },
        },
      };
    case "project":
      return {
        siteName,
        title: `${input.title} | ${siteName}`,
        description: input.description,
        canonical,
        type: "website",
        image,
        favicon,
      };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value: Record<string, unknown>): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function renderSeoHead(metadata: SeoMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const canonical = escapeHtml(metadata.canonical);
  const image = escapeHtml(metadata.image);
  const favicon = escapeHtml(metadata.favicon);
  const publishedTime = metadata.publishedTime
    ? `\n    <meta property="article:published_time" content="${escapeHtml(metadata.publishedTime)}">`
    : "";
  const structuredData = metadata.structuredData
    ? `\n    <script type="application/ld+json">${safeJson(metadata.structuredData)}</script>`
    : "";

  return `<title>${title}</title>
    <meta name="description" content="${description}">
    <meta name="robots" content="max-image-preview:large">
    <link rel="icon" href="${favicon}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:site_name" content="${escapeHtml(metadata.siteName)}">
    <meta property="og:type" content="${metadata.type}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">${publishedTime}${structuredData}`;
}
