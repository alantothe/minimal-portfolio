/**
 * The only place that talks to GitHub during sign-in.
 *
 * It is an interface first and an HTTP client second. The entire security
 * argument for this slice — that a replayed state fails, that a non-owner is
 * refused, that the temporary token is always deleted — has to be provable in
 * tests, and none of it should require a live OAuth App or a network. So the
 * flow depends on `GitHubIdentityClient`, and the real implementation is one of
 * its implementations rather than the thing handlers import.
 *
 * Nothing here ever returns the access token to a caller that does not need it,
 * and nothing here logs. The values passing through are an authorization code,
 * a bearer token, and a client secret; the decision record forbids all three
 * from reaching a log line, and the simplest way to honour that is to have no
 * log statements at all in this file.
 */

import type { AuthConfig } from "./config";

export interface GitHubIdentity {
  id: number;
  login: string;
}

export type TokenExchange =
  | { status: "ok"; accessToken: string; scope: string }
  | { status: "unavailable"; reason: string }
  | { status: "rejected"; reason: string };

export type IdentityLookup =
  | { status: "ok"; identity: GitHubIdentity }
  | { status: "unavailable"; reason: string };

export interface GitHubIdentityClient {
  /** Redeems an authorization code with its PKCE verifier. */
  exchangeCode(code: string, verifier: string): Promise<TokenExchange>;

  /** Reads the authenticated account. Only the numeric id is authoritative. */
  fetchIdentity(accessToken: string): Promise<IdentityLookup>;

  /**
   * Deletes this token, leaving the app's grant intact.
   *
   * Resolves true only on confirmed deletion. A false result must deny the
   * sign-in: the application needs no ongoing GitHub access, so a token it
   * cannot prove it revoked is a credential it has no way to account for.
   */
  deleteToken(accessToken: string): Promise<boolean>;
}

const AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";
const API_VERSION = "2022-11-28";

/**
 * Where the browser is sent to authorize.
 *
 * `scope` is sent explicitly empty rather than omitted. GitHub will re-issue
 * scopes previously granted to the same OAuth App when a later authorization
 * says nothing about them, and this app must never hold any — it proves an
 * identity and then throws the token away.
 */
export function authorizeUrl(
  config: AuthConfig,
  state: string,
  codeChallenge: string
): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", "");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** How long any single GitHub call may take before sign-in fails closed. */
const REQUEST_TIMEOUT_MS = 10_000;

async function postForm(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export class HttpGitHubIdentityClient implements GitHubIdentityClient {
  constructor(private readonly config: AuthConfig) {}

  async exchangeCode(code: string, verifier: string): Promise<TokenExchange> {
    let response: Response;
    try {
      response = await postForm(
        TOKEN_ENDPOINT,
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.callbackUrl,
          code_verifier: verifier,
        }),
        {}
      );
    } catch {
      return { status: "unavailable", reason: "github_unreachable" };
    }

    if (!response.ok) {
      return { status: "unavailable", reason: "token_endpoint_status" };
    }

    let payload: {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
    };
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "token_endpoint_body" };
    }

    // GitHub reports a bad code or a failed PKCE check as a 200 with an `error`
    // field, so status alone is not enough to conclude success.
    if (payload.error || !payload.access_token) {
      return { status: "rejected", reason: "code_rejected" };
    }

    if ((payload.token_type ?? "").toLowerCase() !== "bearer") {
      return { status: "rejected", reason: "unexpected_token_type" };
    }

    return {
      status: "ok",
      accessToken: payload.access_token,
      scope: payload.scope ?? "",
    };
  }

  async fetchIdentity(accessToken: string): Promise<IdentityLookup> {
    let response: Response;
    try {
      response = await fetch(USER_ENDPOINT, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "minimal-portfolio-owner-auth",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { status: "unavailable", reason: "github_unreachable" };
    }

    if (!response.ok) {
      return { status: "unavailable", reason: "user_endpoint_status" };
    }

    let payload: { id?: unknown; login?: unknown };
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "user_endpoint_body" };
    }

    if (typeof payload.id !== "number" || !Number.isSafeInteger(payload.id)) {
      return { status: "unavailable", reason: "user_endpoint_shape" };
    }

    return {
      status: "ok",
      identity: {
        id: payload.id,
        login: typeof payload.login === "string" ? payload.login : "",
      },
    };
  }

  /**
   * Deletes the token, retrying once.
   *
   * One retry, not many: this sits inside a request the Owner is waiting on,
   * and the failure path (deny the sign-in) is safe and recoverable by trying
   * again. A long retry loop would trade a prompt, safe failure for a hung
   * browser.
   */
  async deleteToken(accessToken: string): Promise<boolean> {
    const endpoint = `https://api.github.com/applications/${encodeURIComponent(
      this.config.clientId
    )}/token`;
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${credentials}`,
            "X-GitHub-Api-Version": API_VERSION,
            "User-Agent": "minimal-portfolio-owner-auth",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: accessToken }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        // 204 is deletion; 404 means GitHub no longer knows this token, which
        // is the same end state and equally acceptable.
        if (response.status === 204 || response.status === 404) {
          return true;
        }
      } catch {
        // Fall through to the retry, then to the caller's denial.
      }
    }

    return false;
  }
}
