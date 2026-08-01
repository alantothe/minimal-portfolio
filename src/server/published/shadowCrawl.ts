/**
 * Producing a database-backed answer for a route, off the serving path.
 *
 * This is what #43 means by shadow mode: the generation gets built, the page
 * gets rendered, the response gets described — and then it is compared and
 * thrown away. Nothing here is reachable from a route table, and nothing returns
 * a `Response`. The type is deliberately a plain record rather than the real
 * thing, so that no future refactor can accidentally hand one of these to a
 * Visitor.
 *
 * The headers are copied from what the legacy handlers send today, down to the
 * `Cache-Control` values. #34 changes some of those — content responses become
 * ETag-driven and the sitemap becomes generation-aware — but every one of those
 * is a visitor-facing change, so they belong to the cutover slice. Reproducing
 * today's headers is what keeps this slice's parity run honest about being a
 * content migration and not a caching change smuggled in beside it.
 */

import type { RouteRequest, RouteSnapshot } from "../../baseline/contract";
import { snapshotResponse } from "../../baseline/capture";
import { createErrorResponse, NotFoundError } from "../core/errors";
import { renderPublishedDocument, type SiteEnrichment } from "./render";
import {
  publishedBlogList,
  publishedBlogPostPayload,
  publishedPagePayload,
  publishedProjectList,
  publishedProjectPayload,
  publishedSitemap,
} from "./representations";
import type { PublishedSite } from "./site";
import { parseTarget, type Resolution } from "./target";

/** A described response. Deliberately not a `Response`. */
export interface ShadowResponse {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  location: string | null;
  body: string;
}

/**
 * Routes the golden contract covers that this module does not own.
 *
 * Recorded with a reason rather than quietly filtered, because "which routes did
 * the parity run actually check" is the first question a reviewer should be able
 * to answer, and an unexplained exclusion is the easiest place for a regression
 * to hide.
 */
export const EXCLUDED_ROUTES: Record<string, string> = {
  "/healthz": "Liveness. Not content, and unchanged by this migration.",
  "/robots.txt":
    "#34 keeps robots.txt config-derived and independent of content storage.",
};

const HTML_HEADERS = {
  contentType: "text/html",
  cacheControl: "no-cache",
};

const JSON_HEADERS = {
  contentType: "application/json",
  cacheControl: "no-cache",
};

function json(
  body: unknown,
  status = 200,
  cacheControl: string | null = JSON_HEADERS.cacheControl
): ShadowResponse {
  return {
    status,
    contentType: JSON_HEADERS.contentType,
    cacheControl,
    location: null,
    body: JSON.stringify(body),
  };
}

async function notFoundHtml(message: string): Promise<ShadowResponse> {
  const response = createErrorResponse(new NotFoundError(message));

  return {
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    cacheControl: response.headers.get("Cache-Control"),
    location: null,
    body: await response.text(),
  };
}

/**
 * The `/api/page` route, whose target is a query parameter rather than a path.
 *
 * Mapped here rather than in `parseTarget` because it is an API address for a
 * page, not a page address. Teaching the route parser about it would mean the
 * public URL space and the fragment API shared one vocabulary, and a mistake in
 * one would become a mistake in both.
 */
function apiPageUrl(url: URL): URL | null {
  const name = url.searchParams.get("name");
  const page = url.searchParams.get("page");

  const path =
    name === "home"
      ? "/"
      : name === "about" || name === "blog" || name === "projects"
        ? `/${name}`
        : null;

  if (path === null) return null;

  const target = new URL(path, url.origin);
  if (page !== null) target.searchParams.set("page", page);

  return target;
}

/**
 * Renders one route from the active generation.
 *
 * Returns null for a route this module does not own, which the caller reports as
 * excluded rather than as a failure.
 */
export async function shadowResponseFor(
  path: string,
  site: PublishedSite,
  origin: string,
  enrichment: SiteEnrichment
): Promise<ShadowResponse | null> {
  const url = new URL(path, origin);
  const snapshot = site.snapshot();

  if (path in EXCLUDED_ROUTES) return null;

  if (url.pathname === "/sitemap.xml") {
    const manifest = site.discovery();

    // #34: never an empty sitemap. With no generation there is nothing
    // truthful to say, so the shadow run reports that rather than inventing it.
    if (!manifest) return null;

    return {
      status: 200,
      contentType: "application/xml; charset=utf-8",
      cacheControl: "public, max-age=3600",
      location: null,
      body: publishedSitemap(manifest, url),
    };
  }

  const isApi = url.pathname.startsWith("/api/");

  if (url.pathname === "/api/blog/list") {
    return snapshot ? json(publishedBlogList(snapshot, enrichment)) : null;
  }

  if (url.pathname === "/api/projects/list") {
    return snapshot ? json(publishedProjectList(snapshot)) : null;
  }

  const pageTarget = url.pathname === "/api/page" ? apiPageUrl(url) : null;

  if (url.pathname === "/api/page") {
    if (!pageTarget) {
      return json({ error: "Invalid or missing page name" }, 400, null);
    }
  }

  const lookupUrl = pageTarget ?? contentUrlFor(url);
  if (!lookupUrl) return null;

  const resolution = site.resolveUrl(lookupUrl);
  if (resolution === null) return null;

  return renderResolution(resolution, site, url, isApi, enrichment);
}

/**
 * The public content URL an API route is asking about.
 *
 * `/api/blog/x` and `/blog/x` resolve the same page; only the representation
 * differs. Mapping one onto the other here is what makes "SSR and JSON describe
 * the same generation" true by construction rather than by two code paths
 * agreeing.
 */
function contentUrlFor(url: URL): URL | null {
  if (!url.pathname.startsWith("/api/")) return url;

  const rest = url.pathname.slice("/api".length);
  if (!/^\/(blog|projects)\/.+/.test(rest)) return null;

  return new URL(`${rest}${url.search}`, url.origin);
}

async function renderResolution(
  resolution: Resolution,
  site: PublishedSite,
  requestUrl: URL,
  isApi: boolean,
  enrichment: SiteEnrichment
): Promise<ShadowResponse | null> {
  const snapshot = site.snapshot();

  switch (resolution.outcome) {
    case "redirect":
      return {
        status: 308,
        contentType: null,
        cacheControl: null,
        location: resolution.location,
        body: "",
      };

    case "unavailable":
      // Nothing to compare: the run could not build a generation at all, which
      // the caller reports rather than treating as a page.
      return null;

    case "not-found":
      return isApi
        ? json(
            {
              error: requestUrl.pathname.includes("/blog/")
                ? "Blog post not found"
                : requestUrl.pathname.includes("/projects/")
                  ? "Project not found"
                  : "Collection page not found",
            },
            404,
            null
          )
        : notFoundHtml(notFoundMessageFor(requestUrl));

    case "found": {
      if (!snapshot) return null;

      if (!isApi) {
        return {
          status: 200,
          contentType: HTML_HEADERS.contentType,
          cacheControl: HTML_HEADERS.cacheControl,
          location: null,
          body: await renderPublishedDocument(
            resolution,
            snapshot,
            requestUrl,
            enrichment
          ),
        };
      }

      if (requestUrl.pathname === "/api/page") {
        return json(
          await publishedPagePayload(
            resolution,
            snapshot,
            requestUrl,
            enrichment
          )
        );
      }

      if (resolution.view.kind === "blog-post") {
        return json(
          await publishedBlogPostPayload(
            resolution,
            snapshot,
            requestUrl,
            enrichment
          )
        );
      }

      if (resolution.view.kind === "project") {
        return json(
          await publishedProjectPayload(resolution, snapshot, requestUrl)
        );
      }

      return null;
    }
  }
}

/** The message the legacy 404 page carries, which the contract recorded. */
function notFoundMessageFor(url: URL): string {
  if (/^\/blog\/.+/.test(url.pathname)) return "Blog post not found";
  if (/^\/projects\/.+/.test(url.pathname)) return "Project not found";
  return "Collection page not found";
}

export interface ShadowCrawl {
  snapshots: Map<string, RouteSnapshot>;
  /**
   * The raw body per route, kept so JSON payloads can be diffed structurally.
   * The contract records only a hash for those, and a hash cannot say which
   * field moved.
   */
  bodies: Map<string, string>;
  excluded: Array<{ path: string; reason: string }>;
}

/**
 * Renders every route in the contract that this module owns.
 *
 * Sequential rather than parallel, matching the capture it is compared against:
 * the enrichment values are shared state, and a concurrent crawl could hand two
 * routes different view counts and report the difference as a parity failure.
 */
export async function shadowCrawl(
  routes: RouteRequest[],
  site: PublishedSite,
  origin: string,
  enrichment: SiteEnrichment
): Promise<ShadowCrawl> {
  const snapshots = new Map<string, RouteSnapshot>();
  const bodies = new Map<string, string>();
  const excluded: Array<{ path: string; reason: string }> = [];

  for (const route of routes) {
    const response = await shadowResponseFor(
      route.path,
      site,
      origin,
      enrichment
    );

    if (!response) {
      excluded.push({
        path: route.path,
        reason:
          EXCLUDED_ROUTES[route.path] ??
          "The published module does not own this route.",
      });
      continue;
    }

    snapshots.set(route.path, snapshotResponse(route, response));
    bodies.set(route.path, response.body);
  }

  return { snapshots, bodies, excluded };
}
