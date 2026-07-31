/**
 * Turning a cookie into a session, or refusing to.
 *
 * The three outcomes are kept distinct on purpose. "No session" and "storage is
 * unavailable" both deny the request, but they are different failures: the
 * first is a visitor who has not signed in, the second is a server that cannot
 * currently answer the question. Collapsing them would make an unreachable
 * database look like a signed-out browser, and the natural repair for a
 * signed-out browser — offering the sign-in page — is exactly what must not
 * happen when sessions cannot be written.
 */

import { getDatabase, isDatabaseAvailable } from "../database";
import {
  OwnerAuthRepository,
  type OwnerSession,
} from "../database/authRepository";
import { SESSION_COOKIE, readCookie } from "./policy";
import { digestToken } from "./tokens";

export type SessionResolution =
  | { status: "active"; session: OwnerSession }
  | { status: "none" }
  | { status: "unavailable" };

export function ownerAuthRepository(): OwnerAuthRepository | null {
  if (!isDatabaseAvailable()) {
    return null;
  }

  try {
    return new OwnerAuthRepository(getDatabase());
  } catch {
    return null;
  }
}

export function resolveOwnerSession(
  request: Request,
  now: Date = new Date()
): SessionResolution {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    return { status: "none" };
  }

  const repository = ownerAuthRepository();
  if (!repository) {
    return { status: "unavailable" };
  }

  try {
    const session = repository.findActiveSession(digestToken(token), now);
    if (!session) {
      return { status: "none" };
    }

    // Cheap in the common case: the repository skips the write unless the
    // session has gone untouched for longer than the touch interval.
    repository.touchSession(session.tokenDigest, now);

    return { status: "active", session };
  } catch {
    return { status: "unavailable" };
  }
}
