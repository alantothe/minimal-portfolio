/**
 * Turns a response body into the stable, meaning-bearing values the contract
 * compares.
 *
 * Two representations are kept per HTML route on purpose. `bodyHash` is exact
 * and catches everything, including markup-only changes. The extracted values
 * — headings, links, images, SEO, visible text — say *what* moved when the
 * exact hash changes, which is what makes a failed comparison actionable
 * instead of just alarming.
 */

import { createHash } from "node:crypto";
import type { ImageSnapshot, SeoSnapshot } from "./contract";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * JSON key order is an implementation detail of whichever renderer produced it,
 * so it is sorted away before hashing. A later slice may serialize the same
 * payload from a different code path; that must not read as a regression.
 */
export function stableJsonHash(body: string): string {
  try {
    return sha256(stableStringify(JSON.parse(body) as unknown));
  } catch {
    return sha256(body);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(",")}}`;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

function stripNonVisible(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** Visible text with markup, entities, and whitespace differences removed. */
export function normalizeVisibleText(html: string): string {
  return decodeEntities(stripNonVisible(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(
  html: string,
  attribute: string,
  name: string
): string | null {
  const pattern = new RegExp(
    `<meta[^>]*\\b${attribute}=["']${name}["'][^>]*\\bcontent=["']([^"']*)["']`,
    "i"
  );
  const match = html.match(pattern);
  return match?.[1] === undefined ? null : decodeEntities(match[1]);
}

export function extractSeo(html: string): SeoSnapshot {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const canonicalMatch = html.match(
    /<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']*)["']/i
  );

  return {
    title: titleMatch?.[1] === undefined ? null : decodeEntities(titleMatch[1]),
    description: metaContent(html, "name", "description"),
    canonical:
      canonicalMatch?.[1] === undefined
        ? null
        : decodeEntities(canonicalMatch[1]),
    ogSiteName: metaContent(html, "property", "og:site_name"),
    ogType: metaContent(html, "property", "og:type"),
    ogTitle: metaContent(html, "property", "og:title"),
    ogDescription: metaContent(html, "property", "og:description"),
    ogUrl: metaContent(html, "property", "og:url"),
    ogImage: metaContent(html, "property", "og:image"),
    twitterCard: metaContent(html, "name", "twitter:card"),
    twitterTitle: metaContent(html, "name", "twitter:title"),
    twitterDescription: metaContent(html, "name", "twitter:description"),
    twitterImage: metaContent(html, "name", "twitter:image"),
    articlePublishedTime: metaContent(
      html,
      "property",
      "article:published_time"
    ),
    structuredData: extractStructuredData(html),
  };
}

function extractStructuredData(html: string): unknown[] {
  return Array.from(
    html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ).flatMap((match) => {
    try {
      return [JSON.parse(match[1]!.replaceAll("\\u003c", "<")) as unknown];
    } catch {
      return [];
    }
  });
}

/** Heading hierarchy as `h2:Some heading`, in document order. */
export function extractHeadings(html: string): string[] {
  return Array.from(
    stripNonVisible(html).matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi),
    (match) => `${match[1]!.toLowerCase()}:${normalizeVisibleText(match[2]!)}`
  ).filter((heading) => !heading.endsWith(":"));
}

/**
 * Internal links only. External links belong to whoever they point at and are
 * captured as page text, not as routes this site promises to serve.
 */
export function extractInternalLinks(html: string): string[] {
  const links = Array.from(
    stripNonVisible(html).matchAll(/<a\b[^>]*\bhref=["']([^"']*)["']/gi),
    (match) => decodeEntities(match[1]!)
  ).filter((href) => href.startsWith("/"));

  return Array.from(new Set(links)).sort();
}

export function extractImages(html: string): ImageSnapshot[] {
  return Array.from(
    stripNonVisible(html).matchAll(/<img\b[^>]*>/gi),
    (match) => match[0]
  )
    .map((tag) => ({
      src: decodeEntities(tag.match(/\bsrc=["']([^"']*)["']/i)?.[1] ?? ""),
      alt: (() => {
        const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1];
        return alt === undefined ? null : decodeEntities(alt);
      })(),
    }))
    .sort((left, right) =>
      left.src < right.src ? -1 : left.src > right.src ? 1 : 0
    );
}
