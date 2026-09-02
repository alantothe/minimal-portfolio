/**
 * The JSON and XML a Visitor can receive, built from the same generation as the
 * HTML.
 *
 * These payloads exist so the shadow comparison has something to diff against
 * the legacy API, and so the cutover slice has the finished article to switch
 * to. Their shapes are copied from what the legacy handlers return, field for
 * field, because a Visitor's browser is already parsing them — the SPA reads
 * `content`, `pageCSS`, and `seo` by name, and renaming any of them would be a
 * visitor-facing change this slice is not allowed to make.
 *
 * What is deliberately *not* copied is anything private. #34 requires public
 * JSON to carry only safe rendered fields: no draft data, no raw Markdown, no
 * storage columns, no owner identity. The legacy project payload returns its
 * whole frontmatter object; the published one returns a named list of fields,
 * so a field added to the content model later cannot leak by default.
 */

import { getCanonicalUrl } from "../services/seo";
import { renderProjectArticle } from "../handlers/projects";
import { publicationInstant, publishedSeoMetadata } from "./seo";
import {
  blogPostBody,
  renderPublishedPage,
  toProjectDetail,
  type SiteEnrichment,
  NO_ENRICHMENT,
} from "./render";
import type { SiteSnapshot } from "./snapshot";
import type { DiscoveryManifest } from "./site";
import type { FoundPage } from "./target";

/** The SPA fragment payload, matching what `/api/page` returns today. */
export async function publishedPagePayload(
  page: FoundPage,
  snapshot: SiteSnapshot,
  requestUrl: URL,
  enrichment: SiteEnrichment = NO_ENRICHMENT
): Promise<Record<string, unknown>> {
  const rendered = await renderPublishedPage(page.view, snapshot, enrichment);

  return {
    content: rendered.content,
    title: rendered.title,
    activePage: rendered.activePage,
    pageCSS: rendered.pageCSS,
    seo: publishedSeoMetadata(page, snapshot, requestUrl),
  };
}

export function publishedBlogList(
  snapshot: SiteSnapshot,
  enrichment: SiteEnrichment = NO_ENRICHMENT
): Record<string, unknown> {
  return {
    posts: snapshot.blogPosts.map((post) => ({
      slug: post.slug,
      title: post.title,
      date: publicationInstant(post.publishedAt),
      excerpt: post.excerpt,
      views: enrichment.viewsBySlug[post.slug] ?? 0,
    })),
  };
}

export function publishedProjectList(
  snapshot: SiteSnapshot
): Record<string, unknown> {
  return {
    projects: snapshot.projects.map((project) => ({
      slug: project.slug,
      title: project.title,
      description: project.summary,
      technologies: project.technologies,
      image: project.card?.url,
    })),
  };
}

/**
 * One Blog post as JSON.
 *
 * `views` is passed in rather than read here. #34 moves view *recording* off
 * the content read path entirely, and a content GET that reached a counter
 * would be unsafe to revalidate — which is the whole reason the counts arrive
 * as enrichment.
 */
export async function publishedBlogPostPayload(
  page: FoundPage,
  snapshot: SiteSnapshot,
  requestUrl: URL,
  enrichment: SiteEnrichment = NO_ENRICHMENT
): Promise<Record<string, unknown>> {
  if (page.view.kind !== "blog-post") {
    throw new Error("publishedBlogPostPayload requires a blog post page");
  }

  const { post } = page.view;

  return {
    slug: post.slug,
    metadata: {
      title: post.title,
      // The same instant the SSR page's `article:published_time` carries.
      // Content stores a calendar date; this field has always been a timestamp.
      date: publicationInstant(post.publishedAt),
      excerpt: post.excerpt,
    },
    html: blogPostBody(post),
    views: enrichment.viewsBySlug[post.slug] ?? 0,
    seo: publishedSeoMetadata(page, snapshot, requestUrl),
  };
}

export async function publishedProjectPayload(
  page: FoundPage,
  snapshot: SiteSnapshot,
  requestUrl: URL
): Promise<Record<string, unknown>> {
  if (page.view.kind !== "project") {
    throw new Error("publishedProjectPayload requires a project page");
  }

  const { project } = page.view;

  return {
    slug: project.slug,
    metadata: {
      title: project.title,
      description: project.summary,
      technologies: project.technologies,
      image: project.lead?.url,
      gallery: project.gallery.map((image) => ({
        src: image.url,
        alt: image.alt,
      })),
      videoUrl: project.videoUrl,
    },
    // The legacy payload carries the case-study article rather than the page
    // shell, so the SPA can drop it straight into the container. Rendered from
    // the project directly rather than sliced out of the page HTML — a regex
    // over rendered markup would break the first time the shell changed.
    html: renderProjectArticle(toProjectDetail(project)),
    seo: publishedSeoMetadata(page, snapshot, requestUrl),
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * The sitemap for a generation.
 *
 * Takes the manifest rather than the snapshot so that the caller has already had
 * to confront the null case: #34 forbids emitting an empty sitemap while the
 * site is unavailable, and a function that accepted a possibly-absent generation
 * would make producing one the easy mistake.
 */
export function publishedSitemap(
  manifest: DiscoveryManifest,
  requestUrl: URL
): string {
  // The manifest already holds canonical *paths*; all that is missing is the
  // origin, and `SITE_URL` owns that rather than the request host. Asking the
  // SEO module for the home canonical is how this module gets that origin
  // without re-implementing its precedence rules.
  const origin = new URL(getCanonicalUrl({ kind: "home" }, requestUrl)).origin;

  const entries = Array.from(
    new Set(
      manifest.routes.map((route) => new URL(route, `${origin}/`).toString())
    )
  )
    .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}
