/**
 * Turning a published generation into a Visitor `Response`.
 *
 * Shadow mode rendered the same pages and threw them away. This is the cutover
 * seam that actually serves them: same routing and bodies, plus the ETag
 * revalidation #34 deferred until a Visitor could see it.
 *
 * Returns `null` for a path the published site does not own (`/healthz`,
 * `/admin`, static files). The caller then falls through to the existing
 * router. That is how `/readyz` and Owner routes stay independent of phase.
 */

import { getDatabase, isDatabaseAvailable } from "../database";
import { SystemStateRepository } from "../database/repository";
import { collectEnrichment } from "../published/enrichment";
import { publishedResponse } from "../published/http";
import { getPublishedSite } from "../published/lifecycle";
import { NO_ENRICHMENT, type SiteEnrichment } from "../published/render";
import { shadowResponseFor } from "../published/shadowCrawl";
import type { PublishedSite } from "../published/site";
import { ownsPath } from "../published/target";
import { cutoverPolicy } from "./policy";
import { recordBlogViewIfRequested, sqliteViewsBySlug } from "./views";

export async function servePublishedVisitor(
  request: Request,
  site: PublishedSite,
  enrichment: SiteEnrichment = NO_ENRICHMENT
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search}`;
  const described = await shadowResponseFor(path, site, url.origin, enrichment);

  if (described === null) return null;

  if (described.status === 308 && described.location) {
    return new Response(null, {
      status: 308,
      headers: { Location: described.location },
    });
  }

  if (described.status !== 200 || !described.contentType) {
    const headers = new Headers();
    if (described.contentType) {
      headers.set("Content-Type", described.contentType);
    }
    return new Response(described.body, {
      status: described.status,
      headers,
    });
  }

  const representation = described.contentType.includes("json")
    ? "json"
    : described.contentType.includes("xml")
      ? "xml"
      : "html";
  const generation = site.state().generation ?? "none";

  return publishedResponse(request, {
    body: described.body,
    contentType: described.contentType,
    etagSeed: `${generation}:${path}:${representation}`,
    status: 200,
  });
}

function isPublishedContentPath(url: URL): boolean {
  const path = url.pathname;
  if (path === "/healthz" || path === "/readyz" || path === "/robots.txt") {
    return false;
  }

  return (
    ownsPath(path) ||
    path === "/home" ||
    path === "/sitemap.xml" ||
    path.startsWith("/api/page") ||
    path.startsWith("/api/blog") ||
    path.startsWith("/api/projects")
  );
}

/**
 * The request-pipeline seam. Looks at the persisted phase and either serves
 * the published generation or returns `null` so the legacy router keeps going.
 *
 * Default production stays `legacy`, so merging this slice does not change
 * what Visitors see until an operator advances the phase.
 */
export async function maybeServePublishedVisitor(
  request: Request
): Promise<Response | null> {
  if (!isDatabaseAvailable()) return null;

  const phase = new SystemStateRepository(getDatabase()).getCutoverPhase();
  if (cutoverPolicy(phase).contentSource !== "published") return null;

  const site = getPublishedSite();
  if (!site) return null;

  const url = new URL(request.url);
  if (!isPublishedContentPath(url)) return null;

  await recordBlogViewIfRequested(url, phase, getDatabase());

  const snapshot = site.snapshot();
  const enrichment = snapshot
    ? await collectEnrichment(snapshot)
    : NO_ENRICHMENT;
  if (cutoverPolicy(phase).viewsSource === "sqlite") {
    const viewsBySlug = sqliteViewsBySlug(getDatabase());
    const totalViews = Object.values(viewsBySlug).reduce(
      (sum, count) => sum + count,
      0
    );
    return servePublishedVisitor(request, site, {
      ...enrichment,
      viewsBySlug,
      totalViews,
    });
  }

  return servePublishedVisitor(request, site, enrichment);
}
