/**
 * The attack cases for the sign-in round trip.
 *
 * Every test drives the real `startSignIn` and reuses whatever it produced —
 * the `state` from the redirect it issued, the attempt token from the cookie it
 * set. Nothing is hand-constructed, so a test cannot accidentally pass by
 * agreeing with an assumption the implementation does not actually hold.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database/connection";
import { runMigrations } from "../database/migrator";
import { OwnerAuthRepository } from "../database/authRepository";
import { completeSignIn, startSignIn, type SignInDependencies } from "./signIn";
import type {
  GitHubIdentityClient,
  IdentityLookup,
  TokenExchange,
} from "./githubIdentity";
import type { AuthConfig } from "./config";
import { ATTEMPT_TTL_SECONDS, SESSION_COOKIE, ATTEMPT_COOKIE } from "./policy";
import { pkceChallenge } from "./tokens";

const OWNER_ID = 104442054;

const CONFIG: AuthConfig = {
  clientId: "Ov23liExampleClientId",
  clientSecret: "0".repeat(40),
  ownerId: OWNER_ID,
  origin: "https://example.test",
  callbackUrl: "https://example.test/admin/auth/github/callback",
};

interface StubOptions {
  identityId?: number;
  login?: string;
  scope?: string;
  exchange?: TokenExchange;
  lookup?: IdentityLookup;
  deletionSucceeds?: boolean;
}

/**
 * Stands in for GitHub. It also records what it was asked to do, because two of
 * the required guarantees — that the temporary token is always deleted, and
 * that the PKCE verifier actually reaches the token endpoint — are about the
 * calls made, not the response returned.
 */
class StubGitHub implements GitHubIdentityClient {
  readonly deletedTokens: string[] = [];
  readonly exchanges: Array<{ code: string; verifier: string }> = [];

  constructor(private readonly options: StubOptions = {}) {}

  async exchangeCode(code: string, verifier: string): Promise<TokenExchange> {
    this.exchanges.push({ code, verifier });

    if (this.options.exchange) {
      return this.options.exchange;
    }

    return {
      status: "ok",
      accessToken: "gho_temporary",
      scope: this.options.scope ?? "",
    };
  }

  async fetchIdentity(): Promise<IdentityLookup> {
    if (this.options.lookup) {
      return this.options.lookup;
    }

    return {
      status: "ok",
      identity: {
        id: this.options.identityId ?? OWNER_ID,
        login: this.options.login ?? "alantothe",
      },
    };
  }

  async deleteToken(accessToken: string): Promise<boolean> {
    this.deletedTokens.push(accessToken);
    return this.options.deletionSucceeds ?? true;
  }
}

const temporaryDirectories: string[] = [];

function migratedDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "owner-signin-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function dependencies(options: StubOptions = {}): SignInDependencies & {
  client: StubGitHub;
} {
  return {
    config: CONFIG,
    repository: new OwnerAuthRepository(migratedDatabase()),
    client: new StubGitHub(options),
  };
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(response: Response, name: string): string | null {
  for (const cookie of setCookies(response)) {
    const [pair] = cookie.split(";");
    const separator = pair!.indexOf("=");
    if (pair!.slice(0, separator) === name) {
      return pair!.slice(separator + 1);
    }
  }
  return null;
}

/** Runs a real start, returning what the browser would now be holding. */
function begin(deps: SignInDependencies, now = new Date()) {
  const started = startSignIn(deps, now);
  const location = new URL(started.headers.get("Location")!);

  return {
    started,
    state: location.searchParams.get("state")!,
    challenge: location.searchParams.get("code_challenge")!,
    attemptToken: cookieValue(started, ATTEMPT_COOKIE)!,
  };
}

function callbackRequest(
  state: string,
  attemptToken: string | null,
  code = "github-code"
): { request: Request; url: URL } {
  const url = new URL(CONFIG.callbackUrl);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);

  return {
    url,
    request: new Request(url, {
      headers: attemptToken
        ? { Cookie: `${ATTEMPT_COOKIE}=${attemptToken}` }
        : {},
    }),
  };
}

async function complete(
  deps: SignInDependencies,
  args: { request: Request; url: URL },
  now = new Date()
): Promise<Response> {
  return completeSignIn(args.request, args.url, deps, now);
}

describe("starting a sign-in", () => {
  test("asks GitHub for no scopes at all", () => {
    const { started } = begin(dependencies());
    const location = new URL(started.headers.get("Location")!);

    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(location.searchParams.get("scope")).toBe("");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(CONFIG.callbackUrl);
  });

  test("binds the attempt to this browser with a __Host- cookie", () => {
    const { started } = begin(dependencies());
    const cookie = setCookies(started).find((value) =>
      value.startsWith(ATTEMPT_COOKIE)
    )!;

    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
  });

  test("sends a challenge, never the verifier", () => {
    const deps = dependencies();
    const { challenge, started } = begin(deps);

    expect(started.headers.get("Location")).not.toContain("code_verifier");
    // The stored verifier is what the challenge was derived from.
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBeGreaterThan(0);
  });
});

describe("completing a sign-in", () => {
  test("signs the owner in and deletes the temporary GitHub token", async () => {
    const deps = dependencies();
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin");
    expect(deps.client.deletedTokens).toEqual(["gho_temporary"]);
    expect(cookieValue(response, SESSION_COOKIE)).toBeTruthy();
  });

  test("redeems the code with the verifier the challenge was built from", async () => {
    const deps = dependencies();
    const { state, attemptToken, challenge } = begin(deps);

    await complete(deps, callbackRequest(state, attemptToken));

    const used = deps.client.exchanges[0]!;
    expect(used.code).toBe("github-code");
    expect(pkceChallenge(used.verifier)).toBe(challenge);
  });

  test("clears the attempt cookie once it has been used", async () => {
    const deps = dependencies();
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    const cleared = setCookies(response).find((value) =>
      value.startsWith(ATTEMPT_COOKIE)
    )!;
    expect(cleared).toContain("Max-Age=0");
  });

  test("never caches, and never leaks the code through a referrer", async () => {
    const deps = dependencies();
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

describe("rejected sign-ins", () => {
  test("a state with no attempt cookie is refused", async () => {
    const deps = dependencies();
    const { state } = begin(deps);

    const response = await complete(deps, callbackRequest(state, null));

    expect(response.status).toBe(400);
    expect(cookieValue(response, SESSION_COOKIE)).toBeNull();
  });

  test("a cookie with someone else's state is refused", async () => {
    const deps = dependencies();
    const first = begin(deps);
    const second = begin(deps);

    const response = await complete(
      deps,
      callbackRequest(second.state, first.attemptToken)
    );

    expect(response.status).toBe(400);
    expect(deps.client.exchanges).toHaveLength(0);
  });

  test("a replayed state is refused the second time", async () => {
    const deps = dependencies();
    const { state, attemptToken } = begin(deps);

    const first = await complete(deps, callbackRequest(state, attemptToken));
    const replay = await complete(deps, callbackRequest(state, attemptToken));

    expect(first.status).toBe(303);
    expect(replay.status).toBe(400);
  });

  test("an expired attempt is refused", async () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    const deps = dependencies();
    const { state, attemptToken } = begin(deps, now);

    const tooLate = new Date(now.getTime() + (ATTEMPT_TTL_SECONDS + 1) * 1000);
    const response = await complete(
      deps,
      callbackRequest(state, attemptToken),
      tooLate
    );

    expect(response.status).toBe(400);
  });

  test("a missing code is refused before any GitHub call", async () => {
    const deps = dependencies();
    const { attemptToken } = begin(deps);

    const url = new URL(CONFIG.callbackUrl);
    url.searchParams.set("state", "whatever");
    const request = new Request(url, {
      headers: { Cookie: `${ATTEMPT_COOKIE}=${attemptToken}` },
    });

    const response = await completeSignIn(request, url, deps);

    expect(response.status).toBe(400);
    expect(deps.client.exchanges).toHaveLength(0);
  });

  test("a failed PKCE check at GitHub is refused", async () => {
    const deps = dependencies({
      exchange: { status: "rejected", reason: "code_rejected" },
    });
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(400);
    expect(cookieValue(response, SESSION_COOKIE)).toBeNull();
  });

  test("a token carrying any scope is refused and deleted", async () => {
    const deps = dependencies({ scope: "repo" });
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(403);
    expect(deps.client.deletedTokens).toEqual(["gho_temporary"]);
    expect(cookieValue(response, SESSION_COOKIE)).toBeNull();
  });

  test("a different GitHub account is refused even when the login matches", async () => {
    const deps = dependencies({ identityId: 999, login: "alantothe" });
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(String(OWNER_ID));
    expect(deps.client.deletedTokens).toEqual(["gho_temporary"]);
  });

  test("the owner is accepted after renaming their GitHub login", async () => {
    const deps = dependencies({ identityId: OWNER_ID, login: "someone-new" });
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(303);
  });

  test("an unreachable GitHub denies sign-in without a session", async () => {
    const deps = dependencies({
      exchange: { status: "unavailable", reason: "github_unreachable" },
    });
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(503);
    expect(cookieValue(response, SESSION_COOKIE)).toBeNull();
  });

  test("a token that cannot be deleted denies sign-in", async () => {
    const deps = dependencies({ deletionSucceeds: false });
    const { state, attemptToken } = begin(deps);

    const response = await complete(deps, callbackRequest(state, attemptToken));

    expect(response.status).toBe(503);
    expect(cookieValue(response, SESSION_COOKIE)).toBeNull();
    expect(deps.repository.findActiveSession("anything")).toBeNull();
  });
});

describe("session fixation", () => {
  test("each sign-in mints a new token and retires the previous session", async () => {
    const deps = dependencies();

    const first = begin(deps);
    const firstResponse = await complete(
      deps,
      callbackRequest(first.state, first.attemptToken)
    );
    const firstToken = cookieValue(firstResponse, SESSION_COOKIE)!;

    const second = begin(deps);
    const secondResponse = await complete(
      deps,
      callbackRequest(second.state, second.attemptToken)
    );
    const secondToken = cookieValue(secondResponse, SESSION_COOKIE)!;

    expect(secondToken).not.toBe(firstToken);

    // The first browser's cookie is now worthless.
    const { digestToken } = await import("./tokens");
    expect(
      deps.repository.findActiveSession(digestToken(firstToken))
    ).toBeNull();
    expect(
      deps.repository.findActiveSession(digestToken(secondToken))
    ).not.toBeNull();
  });
});
