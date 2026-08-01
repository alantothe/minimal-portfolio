/**
 * What a Visitor can ask the published site for, and what they can get back.
 *
 * #34 requires `resolve(target)` to return **exactly one** typed result: a found
 * page, a permanent redirect, a not-found, or a temporarily-unavailable. That is
 * the whole reason this file exists separately from the snapshot — the set of
 * answers is a contract the SSR handler, the JSON handler, the sitemap, and the
 * shadow comparison all share, and none of them may invent a fifth one.
 *
 * The distinction that matters most is between `not-found` and `unavailable`.
 * They look similar at a call site and mean opposite things: `not-found` is a
 * successfully loaded generation proving a route does not exist, and
 * `unavailable` is not knowing. Returning the first when the second is true
 * tells a search engine that published URLs were deleted, which is the specific
 * failure #34 calls out and the reason a 404 may never be produced from a
 * missing snapshot.
 */

import type {
  PublishedAbout,
  PublishedBlogPost,
  PublishedBranding,
  PublishedHome,
  PublishedProject,
} from "./snapshot";

/**
 * An address inside the published site, already parsed.
 *
 * A target is not a URL. Route syntax — trailing slashes, the `?page=` spelling,
 * percent-encoding — is decided once in `parseTarget` so that everything
 * downstream compares structured values instead of re-parsing strings and
 * disagreeing about the edges.
 */
export type PublishedTarget =
  | { kind: "home" }
  | { kind: "about" }
  | { kind: "blog-collection"; page: number }
  | { kind: "project-collection"; page: number }
  | { kind: "blog-post"; slug: string }
  | { kind: "project"; slug: string };

export type TargetKind = PublishedTarget["kind"];

/** The safe public view model for one page. Never carries storage fields. */
export type PublishedView =
  | { kind: "home"; home: PublishedHome; branding: PublishedBranding }
  | { kind: "about"; about: PublishedAbout }
  | {
      kind: "blog-collection";
      page: number;
      totalPages: number;
      posts: PublishedBlogPost[];
    }
  | {
      kind: "project-collection";
      page: number;
      totalPages: number;
      projects: PublishedProject[];
    }
  | { kind: "blog-post"; post: PublishedBlogPost }
  | { kind: "project"; project: PublishedProject };

/**
 * A page that exists in the active generation.
 *
 * `generation` and `etagSeed` travel with the page rather than being fetched
 * separately, because a caller that read the view from one generation and the
 * ETag from the next would publish a cache entry that is wrong in the one way
 * caching cannot recover from.
 */
export interface FoundPage {
  outcome: "found";
  target: PublishedTarget;
  canonicalRoute: string;
  view: PublishedView;
  generation: string;
  /**
   * Content-only. Representation (HTML vs JSON) and any optional enrichment
   * generation are mixed in by the responding handler, which is the only layer
   * that knows which of the two it is producing.
   */
  etagSeed: string;
}

export interface PermanentRedirect {
  outcome: "redirect";
  location: string;
}

export interface NotFound {
  outcome: "not-found";
  generation: string;
}

/** No validated generation exists. The truth is unknown, not empty. */
export interface Unavailable {
  outcome: "unavailable";
  reason: string;
}

export type Resolution = FoundPage | PermanentRedirect | NotFound | Unavailable;

/** Routes that permanently moved, independent of any content. */
const FIXED_REDIRECTS: Record<string, string> = {
  "/home": "/",
};

export function fixedRedirectFor(pathname: string): string | null {
  return FIXED_REDIRECTS[pathname] ?? null;
}

/**
 * Reads a collection page number out of a query string.
 *
 * Absent means page 1. Anything else — a float, a zero, a negative, `?page=1`
 * spelled explicitly, or a word — is *not* coerced to 1, because the legacy site
 * 404s those and this module may not quietly start accepting them. `null`
 * therefore means "this is not a valid collection page", not "use the default".
 */
export function parsePageParameter(raw: string | null): number | null {
  if (raw === null) return 1;

  if (!/^[0-9]+$/.test(raw)) return null;

  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}

/** The slug shape the public routes accept. Mirrors the legacy guard exactly. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPublicSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * Whether this path belongs to the published content routes at all.
 *
 * Separate from `parseTarget` because "not a content route" and "a content route
 * with an unusable slug" need opposite answers. `/healthz` is not ours and must
 * fall through to whoever owns it; `/projects/Not%2FA%2FSlug` *is* ours, and the
 * honest answer is a 404 — the same one the legacy site gives. Conflating them
 * would let a malformed slug escape into the static file handler.
 */
export function ownsPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/about" ||
    pathname === "/blog" ||
    pathname === "/projects" ||
    /^\/blog\/.+/.test(pathname) ||
    /^\/projects\/.+/.test(pathname)
  );
}

/**
 * Turns a request URL into a target.
 *
 * Returns null for anything that is not a public content route — `/healthz`,
 * `/admin`, a static file. Those are not this module's to answer, and returning
 * a not-found for them would let a routing mistake read as missing content.
 */
export function parseTarget(url: URL): PublishedTarget | null {
  const pathname = decodePathname(url.pathname);
  if (pathname === null) return null;

  const page = parsePageParameter(url.searchParams.get("page"));

  switch (pathname) {
    case "/":
      return { kind: "home" };
    case "/about":
      return { kind: "about" };
    case "/blog":
      return page === null ? null : { kind: "blog-collection", page };
    case "/projects":
      return page === null ? null : { kind: "project-collection", page };
  }

  const blog = /^\/blog\/(.+)$/.exec(pathname);
  if (blog) {
    return isPublicSlug(blog[1]!)
      ? { kind: "blog-post", slug: blog[1]! }
      : null;
  }

  const project = /^\/projects\/(.+)$/.exec(pathname);
  if (project) {
    return isPublicSlug(project[1]!)
      ? { kind: "project", slug: project[1]! }
      : null;
  }

  return null;
}

/**
 * Decodes a path once, refusing anything that decodes into a different route.
 *
 * `/projects/%2e%2e%2fprojects%2fx` must never become `/projects/../projects/x`.
 * The slug guard would already refuse it, but decoding first and checking after
 * keeps that guarantee in one place rather than depending on the pattern to
 * catch every encoding.
 */
function decodePathname(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // A decoded slash or backslash means the encoding was hiding route structure.
  if (decoded !== pathname && /[/\\]/.test(decoded.slice(1))) {
    const reencoded = pathname.toLowerCase();
    if (reencoded.includes("%2f") || reencoded.includes("%5c")) return null;
  }

  return decoded;
}

/** The canonical route for a target, as a path. Origin is applied by SEO. */
export function canonicalRouteFor(target: PublishedTarget): string {
  switch (target.kind) {
    case "home":
      return "/";
    case "about":
      return "/about";
    case "blog-collection":
      return target.page > 1 ? `/blog?page=${target.page}` : "/blog";
    case "project-collection":
      return target.page > 1 ? `/projects?page=${target.page}` : "/projects";
    case "blog-post":
      return `/blog/${encodeURIComponent(target.slug)}`;
    case "project":
      return `/projects/${encodeURIComponent(target.slug)}`;
  }
}
