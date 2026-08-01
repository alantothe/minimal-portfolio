/**
 * Search and social metadata, derived from the generation being served.
 *
 * #34 requires SEO output to describe the same active generation as the page
 * body, which is why this takes a resolved page rather than a route string: the
 * title, the canonical URL, and the JSON-LD are all computed from the object the
 * renderer is about to turn into HTML, and there is no path by which they could
 * come from a different one.
 *
 * The fallback formulas are not reimplemented here. #36 seeds every SEO override
 * as null so the site's established titles and descriptions stay in charge, so
 * this module supplies the *identity* those formulas need and then applies
 * whatever the Owner explicitly overrode on top.
 */

import {
  buildSeoMetadata,
  getCanonicalUrl,
  type SeoIdentity,
  type SeoMetadata,
  type SeoPageInput,
} from "../services/seo";
import type { PublishedSeo, SiteSnapshot } from "./snapshot";
import type { FoundPage, PublishedView } from "./target";

/**
 * The last-resort sharing image.
 *
 * A deployment asset, in the same class as the favicon, not editable content —
 * which is why reaching for it is not the repository-content fallback #34
 * forbids. It only applies when media delivery is unconfigured or the branding
 * asset is unrenderable; the alternative is emitting an empty `og:image`, and
 * every social preview of every page would break at once.
 */
const FALLBACK_SHARING_IMAGE = "/public/og.png";

/** The SEO shape of a resolved view, before overrides. */
function seoInputFor(view: PublishedView): SeoPageInput {
  switch (view.kind) {
    case "home":
      return { kind: "home" };
    case "about":
      return { kind: "about" };
    case "blog-collection":
      return { kind: "blog", page: view.page };
    case "project-collection":
      return { kind: "projects", page: view.page };
    case "blog-post":
      return {
        kind: "blog-post",
        slug: view.post.slug,
        title: view.post.title,
        description: view.post.excerpt,
        date: view.post.publishedAt ?? "",
      };
    case "project":
      return {
        kind: "project",
        slug: view.project.slug,
        title: view.project.title,
        description: view.project.summary,
      };
  }
}

/** The overrides that apply to the page being rendered, if any. */
function overridesFor(view: PublishedView): PublishedSeo | null {
  switch (view.kind) {
    case "home":
      return view.home.seo;
    case "about":
      return view.about.seo;
    case "blog-post":
      return view.post.seo;
    case "project":
      return view.project.seo;
    case "blog-collection":
    case "project-collection":
      // Collections are generated pages, not authored ones. There is no record
      // whose overrides would apply, and inheriting Home's would be wrong.
      return null;
  }
}

export function publishedIdentity(
  snapshot: SiteSnapshot,
  origin: string
): SeoIdentity {
  const sharing = snapshot.branding.defaultSharingImage?.url;
  const portrait = snapshot.home.portrait?.url;

  return {
    siteName: snapshot.home.displayName,
    role: snapshot.home.professionalTitle,
    sharingImage: sharing ?? absolute(FALLBACK_SHARING_IMAGE, origin),
    portraitImage: portrait ?? absolute(FALLBACK_SHARING_IMAGE, origin),
    socialUrls: snapshot.about.socialLinks.map((link) => link.url),
  };
}

function absolute(path: string, origin: string): string {
  return new URL(path, `${origin}/`).toString();
}

/**
 * Metadata for one resolved page.
 *
 * Overrides are applied *after* the formulas rather than instead of them, so an
 * Owner who set only a description still gets the site's title pattern. A
 * per-page sharing image also replaces the Open Graph and Twitter image
 * together — they describe the same card, and letting them diverge produces a
 * preview that differs by which network renders it.
 */
export function publishedSeoMetadata(
  page: FoundPage,
  snapshot: SiteSnapshot,
  requestUrl: URL
): SeoMetadata {
  const input = seoInputFor(page.view);
  const canonical = getCanonicalUrl(input, requestUrl);
  const origin = new URL(canonical).origin;

  const metadata = buildSeoMetadata(
    input,
    publishedIdentity(snapshot, origin),
    canonical
  );

  const overrides = overridesFor(page.view);
  if (!overrides) return metadata;

  return {
    ...metadata,
    title: overrides.title ?? metadata.title,
    description: overrides.description ?? metadata.description,
    image: overrides.sharingImage?.url ?? metadata.image,
  };
}
