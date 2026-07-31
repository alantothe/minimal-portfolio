/**
 * The single gate in front of the Owner workspace.
 *
 * This is deliberately a path-prefix check applied before routing rather than a
 * wrapper each Owner route opts into. An opt-in guard protects the routes
 * somebody remembered to wrap; this one protects everything under `/admin` that
 * exists now or is added later, including static assets. The failure mode of
 * forgetting to register a route here is a 404, not an unguarded page.
 *
 * The exceptions are enumerated as exact paths, never as prefixes, so a route
 * like `/admin/auth/github/start/../../secret` cannot be talked into looking
 * like an exception. (The URL is normalized before it reaches here, but stating
 * exact equality means the property does not depend on that.)
 */

import { resolveOwnerSession } from "./session";
import { constantTimeEquals } from "./tokens";
import type { OwnerSession } from "../database/authRepository";
import { resolveAuthConfig } from "./config";

export const OWNER_PREFIX = "/admin";

/** The only paths inside the workspace reachable without a session. */
const UNPROTECTED_PATHS = new Set([
  "/admin/login",
  "/admin/auth/github/start",
  "/admin/auth/github/callback",
]);

export function isOwnerPath(pathname: string): boolean {
  return pathname === OWNER_PREFIX || pathname.startsWith(`${OWNER_PREFIX}/`);
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/admin/api/");
}

/**
 * Headers every private response carries.
 *
 * `no-store` keeps the workspace out of shared and browser caches. `Vary:
 * Cookie` stops any cache that ignores the first header from serving one
 * visitor's page to another. `X-Robots-Tag` keeps the workspace out of search
 * results even if a URL leaks.
 */
export function applyPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  const vary = headers.get("Vary");
  if (!vary) {
    headers.set("Vary", "Cookie");
  } else if (!/\bcookie\b/i.test(vary)) {
    headers.set("Vary", `${vary}, Cookie`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonDenial(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Same-origin and CSRF-token check for a mutation.
 *
 * Both are required rather than either. `Origin` is set by the browser and
 * cannot be forged by page script, which defeats cross-site form posts; the
 * token defeats anything that can present a plausible `Origin` but cannot read
 * the authenticated HTML that carries the token. Neither alone covers both.
 */
export function checkMutationSafety(
  request: Request,
  session: OwnerSession,
  expectedOrigin: string
): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null" || origin !== expectedOrigin) {
    return jsonDenial(403, "origin_rejected");
  }

  const presented = request.headers.get("X-CSRF-Token");
  if (!presented || !constantTimeEquals(presented, session.csrfToken)) {
    return jsonDenial(403, "csrf_rejected");
  }

  return null;
}

export interface OwnerGuardOutcome {
  /** Set when the request must not proceed. */
  denial: Response | null;
  /** Set when the request is an authenticated Owner. */
  session: OwnerSession | null;
}

export function guardOwnerRequest(
  request: Request,
  url: URL,
  now: Date = new Date()
): OwnerGuardOutcome {
  const isApi = isApiPath(url.pathname);

  if (UNPROTECTED_PATHS.has(url.pathname)) {
    return { denial: null, session: null };
  }

  const resolution = resolveOwnerSession(request, now);

  if (resolution.status === "unavailable") {
    // Never offer the sign-in page here. Sign-in writes a session, and session
    // storage is precisely what is not working.
    return {
      denial: isApi
        ? jsonDenial(503, "session_storage_unavailable")
        : new Response("Owner workspace unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      session: null,
    };
  }

  if (resolution.status === "none") {
    return {
      denial: isApi
        ? jsonDenial(401, "authentication_required")
        : new Response(null, {
            status: 303,
            headers: { Location: "/admin/login" },
          }),
      session: null,
    };
  }

  if (UNSAFE_METHODS.has(request.method)) {
    const configured = resolveAuthConfig();
    if (configured.status !== "configured") {
      return { denial: jsonDenial(503, "auth_unconfigured"), session: null };
    }

    const unsafe = checkMutationSafety(
      request,
      resolution.session,
      configured.config.origin
    );
    if (unsafe) {
      return { denial: unsafe, session: null };
    }
  }

  return { denial: null, session: resolution.session };
}
