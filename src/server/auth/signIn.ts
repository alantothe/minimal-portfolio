/**
 * The sign-in round trip.
 *
 * Both halves take their collaborators as arguments — configuration, storage,
 * and a `GitHubIdentityClient` — so the whole flow, including every rejection
 * path, runs in tests without a live OAuth App. That is the point: the
 * interesting behaviour here is what happens when things go *wrong*, and a
 * design that can only be exercised by successfully signing in leaves exactly
 * those paths untested.
 *
 * Every failure denies the sign-in and creates no session. There is no partial
 * success: a temporary GitHub token that could not be deleted, an identity that
 * is not the owner, and an unreachable GitHub all end the same way.
 */

import type { AuthConfig } from "./config";
import { authorizeUrl, type GitHubIdentityClient } from "./githubIdentity";
import {
  attemptCookie,
  clearedCookie,
  sessionCookie,
  ATTEMPT_COOKIE,
  readCookie,
  SESSION_COOKIE,
} from "./policy";
import { createToken, digestToken, pkceChallenge } from "./tokens";
import type { OwnerAuthRepository } from "../database/authRepository";

export interface SignInDependencies {
  config: AuthConfig;
  repository: OwnerAuthRepository;
  client: GitHubIdentityClient;
}

/**
 * Structured events only: a name, and nothing drawn from the request.
 * Authorization codes, tokens, cookies, state values, and the PKCE verifier are
 * all forbidden from logs by the decision record, so nothing variable is
 * interpolated here at all.
 */
function logEvent(event: string): void {
  console.log(`[owner-auth] ${event}`);
}

/**
 * Responses in this flow are never cacheable and never leak a referrer.
 *
 * The callback URL contains an authorization code in its query string. Without
 * `no-referrer`, following any link from a rendered callback page would send
 * that code to a third party in the `Referer` header.
 */
function authResponse(
  status: number,
  headers: Record<string, string>,
  body: string | null = null
): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}

/**
 * Every rejection looks the same from outside: a short generic message, the
 * attempt cookie cleared, and no session. The `event` name distinguishes them
 * in the log; the response deliberately does not, so a caller probing the
 * callback learns only that it failed.
 */
function failure(status: number, event: string): Response {
  logEvent(event);

  const message =
    status === 400
      ? "Invalid sign-in attempt."
      : status === 403
        ? "Not authorized."
        : "Sign-in is temporarily unavailable.";

  const response = authResponse(
    status,
    { "Content-Type": "text/plain; charset=utf-8" },
    message
  );
  response.headers.append("Set-Cookie", clearedCookie(ATTEMPT_COOKIE));
  return response;
}

export function startSignIn(
  dependencies: SignInDependencies,
  now: Date = new Date()
): Response {
  const { config, repository } = dependencies;

  const state = createToken();
  const verifier = createToken();
  const attemptToken = createToken();

  repository.createAttempt(
    {
      attemptTokenDigest: digestToken(attemptToken),
      stateDigest: digestToken(state),
      pkceVerifier: verifier,
    },
    now
  );

  logEvent("oauth_started");

  const response = authResponse(303, {
    Location: authorizeUrl(config, state, pkceChallenge(verifier)),
  });
  response.headers.append("Set-Cookie", attemptCookie(attemptToken));
  return response;
}

export async function completeSignIn(
  request: Request,
  url: URL,
  dependencies: SignInDependencies,
  now: Date = new Date()
): Promise<Response> {
  const { config, repository, client } = dependencies;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const attemptToken = readCookie(request, ATTEMPT_COOKIE);

  if (!code || !state || !attemptToken) {
    return failure(400, "oauth_state_rejected");
  }

  // One atomic claim: valid, unexpired, unconsumed, and belonging to this
  // browser, all decided by the storage layer in a single statement.
  const verifier = repository.consumeAttempt(
    digestToken(attemptToken),
    digestToken(state),
    now
  );

  if (!verifier) {
    return failure(400, "oauth_state_rejected");
  }

  const exchange = await client.exchangeCode(code, verifier);

  if (exchange.status === "unavailable") {
    return failure(503, "oauth_github_failed");
  }

  if (exchange.status === "rejected") {
    return failure(400, "oauth_state_rejected");
  }

  // This app is registered with no scopes and must stay that way. GitHub can
  // re-issue previously granted scopes, so a non-empty scope means this token
  // carries access the workspace never asked for and must not hold.
  if (exchange.scope.trim() !== "") {
    await client.deleteToken(exchange.accessToken);
    return failure(403, "oauth_owner_rejected");
  }

  const lookup = await client.fetchIdentity(exchange.accessToken);

  if (lookup.status === "unavailable") {
    await client.deleteToken(exchange.accessToken);
    return failure(503, "oauth_github_failed");
  }

  // The numeric id is the whole authorization decision. Login names can be
  // changed and re-registered by someone else; the id cannot.
  if (lookup.identity.id !== config.ownerId) {
    await client.deleteToken(exchange.accessToken);
    // A generic refusal: revealing which account was expected would tell an
    // unapproved visitor exactly whose account to go after.
    return failure(403, "oauth_owner_rejected");
  }

  // Before the session, not after. The application needs no further GitHub
  // access, so a token it cannot confirm it revoked is an unaccounted-for
  // credential and the sign-in does not happen.
  if (!(await client.deleteToken(exchange.accessToken))) {
    return failure(503, "oauth_github_failed");
  }

  const sessionToken = createToken();
  repository.createSession(
    {
      tokenDigest: digestToken(sessionToken),
      githubUserId: lookup.identity.id,
      csrfToken: createToken(),
    },
    now
  );

  logEvent("session_created");

  const response = authResponse(303, { Location: "/admin" });
  response.headers.append("Set-Cookie", sessionCookie(sessionToken));
  response.headers.append("Set-Cookie", clearedCookie(ATTEMPT_COOKIE));
  return response;
}

export function signOut(
  repository: OwnerAuthRepository,
  tokenDigest: string,
  now: Date = new Date()
): Response {
  repository.revokeSession(tokenDigest, now);
  logEvent("session_revoked");

  const response = authResponse(303, { Location: "/admin/login" });
  response.headers.append("Set-Cookie", clearedCookie(SESSION_COOKIE));
  return response;
}
