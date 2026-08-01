/**
 * The boundary, exercised through the real request pipeline.
 *
 * These go through `RequestHandler` rather than calling the guard directly,
 * because the guarantees being checked are properties of the pipeline: that the
 * guard runs ahead of both routing and static serving, that a path matching no
 * route is still refused, and that the private headers survive compression.
 * A test that called `guardOwnerRequest` in isolation would prove none of that.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "../core/router";
import { RequestHandler } from "../core/requestHandler";
import { setupRoutes } from "../routes";
import { closeDatabase, getDatabase, initializeDatabase } from "../database";
import { OwnerAuthRepository } from "../database/authRepository";
import { SESSION_COOKIE } from "./policy";
import { createToken, digestToken } from "./tokens";

const ORIGIN = "https://example.test";

const ENVIRONMENT_KEYS = [
  "CONTENT_DATABASE_FILE",
  "SITE_URL",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GITHUB_OWNER_ID",
] as const;

const previousEnvironment = new Map(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
);

let temporaryDirectory: string;
let handler: RequestHandler;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "owner-boundary-"));

  process.env.CONTENT_DATABASE_FILE = join(
    temporaryDirectory,
    "content.sqlite"
  );
  process.env.SITE_URL = ORIGIN;
  process.env.GITHUB_OAUTH_CLIENT_ID = "Ov23liExampleClientId";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "0".repeat(40);
  process.env.GITHUB_OWNER_ID = "104442054";

  initializeDatabase();

  const router = new Router();
  setupRoutes(router);
  handler = new RequestHandler(router);
});

afterEach(() => {
  closeDatabase();
  rmSync(temporaryDirectory, { recursive: true, force: true });

  for (const [key, value] of previousEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/** Signs a browser in without going through GitHub. */
function establishSession(): { cookie: string; csrfToken: string } {
  const repository = new OwnerAuthRepository(getDatabase());
  const token = createToken();
  const csrfToken = createToken();

  repository.createSession({
    tokenDigest: digestToken(token),
    githubUserId: 104442054,
    csrfToken,
  });

  return { cookie: `${SESSION_COOKIE}=${token}`, csrfToken };
}

function send(
  path: string,
  init: RequestInit & { cookie?: string } = {}
): Promise<Response> {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) {
    headers.set("Cookie", cookie);
  }

  return handler.handleRequest(
    new Request(`${ORIGIN}${path}`, { ...rest, headers })
  );
}

describe("denying the unauthenticated", () => {
  test.each([
    "/admin",
    "/admin/",
    "/admin/preview/some-draft",
    "/admin/assets/workspace.js",
    "/admin/anything/not/registered",
  ])("sends %p to the sign-in page", async (path) => {
    const response = await send(path);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/login");
  });

  test("answers owner APIs with 401 JSON rather than a redirect", async () => {
    const response = await send("/admin/api/content");

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "authentication_required" });
  });

  test("refuses a forged session cookie", async () => {
    const response = await send("/admin", {
      cookie: `${SESSION_COOKIE}=${createToken()}`,
    });

    expect(response.status).toBe(303);
  });

  test("keeps the sign-in page itself reachable", async () => {
    const response = await send("/admin/login");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/admin/auth/github/start");
  });
});

describe("private response headers", () => {
  test.each(["/admin", "/admin/login", "/admin/api/content"])(
    "%p is never cached or indexed",
    async (path) => {
      const response = await send(path);

      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(response.headers.get("Vary")).toContain("Cookie");
    }
  );

  test("survives gzip, which also appends to Vary", async () => {
    const response = await send("/admin/login", {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
  });
});

describe("the signed-in owner", () => {
  test("reaches an empty workspace", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin", { cookie });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Owner workspace");
  });

  test("is redirected away from the sign-in page", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin/login", { cookie });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin");
  });
});

describe("mutations", () => {
  test("logging out through GET is refused as a method error", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin/logout", { cookie });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toContain("POST");
  });

  test("is refused without an Origin header", async () => {
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/logout", {
      method: "POST",
      cookie,
      headers: { "X-CSRF-Token": csrfToken },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_rejected" });
  });

  test("is refused from another origin", async () => {
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/logout", {
      method: "POST",
      cookie,
      headers: { Origin: "https://attacker.test", "X-CSRF-Token": csrfToken },
    });

    expect(response.status).toBe(403);
  });

  test("is refused with the right Origin but no CSRF token", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin/logout", {
      method: "POST",
      cookie,
      headers: { Origin: ORIGIN },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "csrf_rejected" });
  });

  test("is refused with another session's CSRF token", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin/logout", {
      method: "POST",
      cookie,
      headers: { Origin: ORIGIN, "X-CSRF-Token": createToken() },
    });

    expect(response.status).toBe(403);
  });

  test("succeeds with both, revoking the session and clearing the cookie", async () => {
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/logout", {
      method: "POST",
      cookie,
      headers: { Origin: ORIGIN, "X-CSRF-Token": csrfToken },
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/login");
    expect(
      response.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE))
    ).toContain("Max-Age=0");

    // Server-side revocation, not just a cleared cookie: the same token is now
    // rejected even if the browser kept it.
    const afterLogout = await send("/admin", { cookie });
    expect(afterLogout.status).toBe(303);
  });
});

describe("the public site", () => {
  test.each(["/", "/about", "/blog", "/projects", "/healthz"])(
    "%p is unchanged by a session cookie",
    async (path) => {
      const { cookie } = establishSession();

      const anonymous = await send(path);
      const signedIn = await send(path, { cookie });

      expect(signedIn.status).toBe(anonymous.status);
      expect(await signedIn.text()).toBe(await anonymous.text());
    }
  );

  test.each(["/", "/about", "/blog"])(
    "%p references nothing from the owner workspace",
    async (path) => {
      const body = await (await send(path)).text();

      expect(body).not.toContain("/admin");
      expect(body).not.toContain("csrf");
    }
  );

  test("public responses stay cacheable", async () => {
    const response = await send("/about");

    expect(response.headers.get("Cache-Control")).not.toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });
});
