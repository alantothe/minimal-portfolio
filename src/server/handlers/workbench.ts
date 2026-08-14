/**
 * The Workbench's two routes: the workspace, and the document it previews.
 *
 * The preview is a separate route rendered into an iframe rather than markup
 * inlined into the workspace. That is a deliberate choice and the reason is
 * isolation: the public page carries its own stylesheet, its own script, and its
 * own DOM ids, and inlining it would let the site being edited restyle the tool
 * editing it. An iframe also makes the preview *exactly* what a Visitor gets,
 * because it is the same renderer answering the same way — which is the property
 * #44 asks for by the word "exact".
 *
 * Both routes sit under `/admin`, so both are behind the Owner boundary and
 * neither is reachable by a Visitor. No visitor-facing behaviour changes here:
 * the published generation is still served to nobody.
 */

import type { RouteContext } from "../core/router";
import { resolveOwnerSession } from "../auth/session";
import { applyPrivateHeaders } from "../auth/ownerBoundary";
import { getPublishedSite } from "../published/lifecycle";
import { renderPublishedDocument } from "../published/render";
import { collectEnrichment } from "../published/enrichment";
import {
  contentLibrary,
  defaultContentId,
  defaultPreviewRoute,
  findLibraryEntry,
  isPreviewableRoute,
} from "../workbench/library";
import { configurePreviewDocument } from "../workbench/preview";
import { renderWorkbench } from "../workbench/layout";

function html(body: string, status = 200): Response {
  return applyPrivateHeaders(
    new Response(body, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  );
}

function signedOut(): Response {
  return applyPrivateHeaders(
    new Response(null, { status: 303, headers: { Location: "/admin/login" } })
  );
}

export async function workbenchHandler({
  request,
  url,
}: RouteContext): Promise<Response> {
  const resolution = resolveOwnerSession(request);
  if (resolution.status !== "active") {
    // The boundary already refused anything unauthenticated; reaching here
    // means state changed mid-request, so fail closed rather than render.
    return signedOut();
  }

  const site = getPublishedSite();
  const state = site?.state() ?? null;
  const snapshot = site?.snapshot() ?? null;
  const sections = snapshot ? contentLibrary(snapshot) : [];

  // A workspace with no generation still renders. The owner needs to be told
  // why the preview is empty, and a 503 here would tell them nothing and take
  // the sign-out button away with it.
  const requestedContentId = url.searchParams.get("content");
  const legacyRequestedRoute = url.searchParams.get("route");
  const selectedEntry =
    (requestedContentId && findLibraryEntry(sections, requestedContentId)) ||
    (legacyRequestedRoute
      ? (sections
          .flatMap((section) => section.entries)
          .find((entry) => entry.route === legacyRequestedRoute) ?? null)
      : null) ||
    findLibraryEntry(sections, defaultContentId());
  const previewRoute = selectedEntry?.route ?? defaultPreviewRoute();

  return html(
    renderWorkbench({
      generation: state?.generation ?? null,
      publishedSiteStatus: state?.status ?? "unavailable",
      draftStatus: "not-opened",
      sections,
      selectedContentId: selectedEntry?.id ?? defaultContentId(),
      previewRoute,
      csrfToken: resolution.session.csrfToken,
    })
  );
}

/**
 * The public document for one route, for the preview pane.
 *
 * Refuses any route the active generation does not publish. The check is not
 * about trusting the owner — it is that a renderer which will answer for an
 * arbitrary path is one redirect away from being a way to fetch something else
 * through an authenticated session.
 */
export async function workbenchPreviewHandler({
  request,
  url,
}: RouteContext): Promise<Response> {
  if (resolveOwnerSession(request).status !== "active") {
    return signedOut();
  }

  const site = getPublishedSite();
  const snapshot = site?.snapshot();

  if (!site || !snapshot) {
    return html("<!doctype html><p>No published version to preview.</p>", 503);
  }

  const route = url.searchParams.get("route") ?? defaultPreviewRoute();

  if (!isPreviewableRoute(snapshot, route)) {
    return html("<!doctype html><p>That route is not published.</p>", 404);
  }

  // Rendered against the *public* origin, so canonical URLs and SEO tags in the
  // preview read as they will in production rather than naming `/admin`.
  const publicUrl = new URL(route, url.origin);
  const resolved = site.resolveUrl(publicUrl);

  if (resolved?.outcome !== "found") {
    return html("<!doctype html><p>That route is not published.</p>", 404);
  }

  const document = await renderPublishedDocument(
    resolved,
    snapshot,
    publicUrl,
    await collectEnrichment(snapshot)
  );

  return html(configurePreviewDocument(document, route));
}
