/**
 * Crawls the real request pipeline in-process and records what it returned.
 *
 * The crawl goes through `RequestHandler`, not through the individual handlers,
 * so routing, static serving, method handling, and error responses are all part
 * of what gets frozen. Nothing is stubbed except the environment (see
 * `environment.ts`).
 */

import { RequestHandler } from "../server/core/requestHandler";
import { Router } from "../server/core/router";
import { setupRoutes } from "../server/routes";
import {
  BASELINE_ORIGIN,
  BASELINE_VERSION,
  type GoldenContract,
  type RouteRequest,
  type RouteSnapshot,
} from "./contract";
import { withBaselineEnvironment } from "./environment";
import {
  fingerprintContent,
  fingerprintMedia,
  fingerprintViews,
} from "./fingerprints";
import {
  extractHeadings,
  extractImages,
  extractInternalLinks,
  extractSeo,
  normalizeVisibleText,
  sha256,
  stableJsonHash,
} from "./normalize";
import { buildRouteManifest } from "./routeManifest";

function createRequestHandler(): RequestHandler {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

function isHtml(contentType: string | null): boolean {
  return contentType?.includes("html") ?? false;
}

function isJson(contentType: string | null): boolean {
  return contentType?.includes("json") ?? false;
}

function isText(contentType: string | null): boolean {
  return (
    contentType?.startsWith("text/") || contentType?.includes("xml") || false
  );
}

async function captureRoute(
  handler: RequestHandler,
  route: RouteRequest
): Promise<RouteSnapshot> {
  // No Accept-Encoding: the pipeline gzips compressible responses when offered,
  // and a hash of compressed bytes would describe the compressor, not the page.
  const response = await handler.handleRequest(
    new Request(new URL(route.path, BASELINE_ORIGIN))
  );

  const contentType = response.headers.get("Content-Type");
  const body = await response.text();
  const html = isHtml(contentType);

  return {
    path: route.path,
    kind: route.kind,
    status: response.status,
    contentType,
    cacheControl: response.headers.get("Cache-Control"),
    location: response.headers.get("Location"),
    bodyHash: isJson(contentType) ? stableJsonHash(body) : sha256(body),
    textHash:
      html || isText(contentType) ? sha256(normalizeVisibleText(body)) : null,
    headings: html ? extractHeadings(body) : [],
    internalLinks: html ? extractInternalLinks(body) : [],
    images: html ? extractImages(body) : [],
    seo: html ? extractSeo(body) : null,
  };
}

/**
 * Captures the full contract. Routes are crawled sequentially: the site reads
 * shared view state, and a stable ordering keeps the artifact diffable.
 */
export async function captureGoldenContract(): Promise<GoldenContract> {
  return withBaselineEnvironment(async () => {
    const handler = createRequestHandler();
    const manifest = await buildRouteManifest();

    const routes: RouteSnapshot[] = [];
    for (const route of manifest) {
      routes.push(await captureRoute(handler, route));
    }

    const [content, media, views] = await Promise.all([
      fingerprintContent(),
      fingerprintMedia(),
      fingerprintViews(),
    ]);

    return {
      version: BASELINE_VERSION,
      origin: BASELINE_ORIGIN,
      routes,
      content,
      media,
      views,
    };
  });
}

export function serializeGoldenContract(contract: GoldenContract): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
