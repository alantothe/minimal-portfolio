/**
 * The Owner boundary's fixed rules: how long things live, and what the cookies
 * carrying them look like.
 *
 * These are gathered in one place because they are the numbers a reviewer wants
 * to check against the decision record, and because a cookie whose attributes
 * are assembled at each call site eventually grows a call site that forgets
 * `HttpOnly`.
 */

/** An in-flight sign-in. Long enough to authorize at GitHub, no longer. */
export const ATTEMPT_TTL_SECONDS = 10 * 60;

/** Inactivity that ends a session. */
export const IDLE_TTL_SECONDS = 30 * 60;

/** The hard ceiling. Never extended, whatever the Owner is doing. */
export const ABSOLUTE_TTL_SECONDS = 12 * 60 * 60;

/**
 * How stale `last_seen_at` may get before a request pays for a write. Idle
 * expiry is measured in half-hours, so five minutes of imprecision costs
 * nothing and saves a database write on every single request.
 */
export const TOUCH_INTERVAL_SECONDS = 5 * 60;

export const SESSION_COOKIE = "__Host-owner_session";
export const ATTEMPT_COOKIE = "__Host-owner_oauth";

/**
 * A `__Host-`-prefixed cookie.
 *
 * The prefix is a browser-enforced promise: the cookie must be `Secure`, must
 * have `Path=/`, and must have no `Domain`. That combination makes it host-only
 * and un-settable by a subdomain, which is what stops a compromised or
 * attacker-registered sibling host from injecting a session cookie. Because the
 * browser rejects the cookie outright if the attributes do not match, these
 * three are not optional and this function does not offer them as parameters.
 */
function hostCookie(
  name: string,
  value: string,
  maxAgeSeconds: number
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

export function sessionCookie(token: string): string {
  return hostCookie(SESSION_COOKIE, token, ABSOLUTE_TTL_SECONDS);
}

export function attemptCookie(token: string): string {
  return hostCookie(ATTEMPT_COOKIE, token, ATTEMPT_TTL_SECONDS);
}

/**
 * Clearing a cookie requires the same attributes it was set with, or the
 * browser treats it as a different cookie and leaves the original in place.
 */
export function clearedCookie(name: string): string {
  return hostCookie(name, "", 0);
}

/**
 * Reads one cookie from a request.
 *
 * Written by hand rather than pulled in as a dependency because the Owner
 * boundary should not widen the supply chain, and because the parsing rules
 * that matter here are narrow: split on `;`, take the first `=`, ignore the
 * rest. A duplicate name returns the first value, which is what browsers send
 * for the more specific path — and `__Host-` cookies are always `Path=/`, so
 * duplicates cannot be induced by path games in the first place.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }

  return null;
}
