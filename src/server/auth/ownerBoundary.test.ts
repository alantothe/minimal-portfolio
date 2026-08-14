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
import { seedSite } from "../published/fixtures";
import { SINGLETON_IDS } from "../content/identity";
import { ContentRepository } from "../database/contentRepository";

const ORIGIN = "https://example.test";

const ENVIRONMENT_KEYS = [
  "CONTENT_DATABASE_FILE",
  "SITE_URL",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GITHUB_OWNER_ID",
  // Listed so the media variables are *cleared*, not inherited. Bun loads
  // `.env` into the test process, so once a developer holds real Cloudinary
  // credentials this suite would otherwise start exercising a different code
  // path than it does in CI — which is how a green suite quietly stops
  // testing what it claims to.
  "MEDIA_PROVIDER",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

/** Variables every test in this file requires to be absent. */
const CLEARED_KEYS = [
  "MEDIA_PROVIDER",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
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

  for (const key of CLEARED_KEYS) {
    delete process.env[key];
  }

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

  test("opens the requested singleton in the schema editor", async () => {
    seedSite(getDatabase());
    const { cookie } = establishSession();

    const response = await send("/admin?content=singleton%3Aabout", { cookie });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('data-content-id="singleton:about"');
    expect(body).toContain('data-content-type="about"');
    expect(body).toContain("<legend>Content</legend>");
    expect(body).toContain("<legend>Media</legend>");
    expect(body).toContain("<legend>Metadata</legend>");
    expect(body).toContain("Autosaves after you pause");
  });

  test("previews a safe draft even while publication-required fields are empty", async () => {
    seedSite(getDatabase());
    const repository = new ContentRepository(getDatabase());
    const home = repository.findById(SINGLETON_IDS.home)!;
    repository.update(
      home.id,
      {
        data: {
          ...(home.data as object),
          displayName: "",
          professionalTitle: "Draft-only title",
        },
      },
      "owner"
    );
    const { cookie } = establishSession();

    const response = await send("/admin/preview?route=/", { cookie });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Draft-only title");
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

describe("singleton Content draft API", () => {
  test("reads a draft only for the signed-in Owner", async () => {
    seedSite(getDatabase());

    expect(
      (await send(`/admin/api/content/${SINGLETON_IDS.home}`)).status
    ).toBe(401);

    const { cookie } = establishSession();
    const response = await send(
      `/admin/api/content/${encodeURIComponent(SINGLETON_IDS.home)}`,
      { cookie }
    );
    const body = (await response.json()) as {
      draft: { id: string; data: { displayName: string } };
    };

    expect(response.status).toBe(200);
    expect(body.draft.id).toBe(SINGLETON_IDS.home);
    expect(body.draft.data.displayName).toBe("Ada Lovelace");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("autosaves through Origin, CSRF, validation, and optimistic concurrency", async () => {
    seedSite(getDatabase());
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(SINGLETON_IDS.home)}`;
    const read = await send(path, { cookie });
    const current = (await read.json()) as {
      draft: {
        updatedAt: string;
        data: Record<string, unknown>;
      };
    };

    const response = await send(path, {
      method: "PUT",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedUpdatedAt: current.draft.updatedAt,
        data: { ...current.draft.data, displayName: "Grace Hopper" },
      }),
    });

    expect(response.status).toBe(200);
    expect(
      (
        new ContentRepository(getDatabase()).findById(SINGLETON_IDS.home)
          ?.data as { displayName: string }
      ).displayName
    ).toBe("Grace Hopper");

    const stale = await send(path, {
      method: "PUT",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedUpdatedAt: current.draft.updatedAt,
        data: current.draft.data,
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toHaveProperty("error", "content_conflict");
  });

  test("rejects unknown fields without changing stored content", async () => {
    seedSite(getDatabase());
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(SINGLETON_IDS.home)}`;
    const read = await send(path, { cookie });
    const current = (await read.json()) as {
      draft: { updatedAt: string; data: Record<string, unknown> };
    };

    const response = await send(path, {
      method: "PUT",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedUpdatedAt: current.draft.updatedAt,
        data: { ...current.draft.data, arbitraryHtml: "<b>no</b>" },
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "validation_failed",
      findings: [
        {
          field: "arbitraryHtml",
          code: "unknown_field",
          severity: "error",
        },
      ],
    });
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

/**
 * The media endpoint is guarded by the same boundary as everything else under
 * /admin, but "the prefix covers it" is worth proving against the real
 * registered route rather than inferred from a path that happens to match.
 */
describe("the media endpoint inherits the boundary", () => {
  test("refuses an anonymous upload with 401 JSON", async () => {
    const response = await send("/admin/api/media", { method: "POST" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_required" });
  });

  test("refuses an upload with no Origin", async () => {
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/api/media", {
      method: "POST",
      cookie,
      headers: { "X-CSRF-Token": csrfToken },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_rejected" });
  });

  test("refuses an upload from another origin", async () => {
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/api/media", {
      method: "POST",
      cookie,
      headers: { Origin: "https://attacker.test", "X-CSRF-Token": csrfToken },
    });

    expect(response.status).toBe(403);
  });

  test("refuses an upload with no CSRF token", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin/api/media", {
      method: "POST",
      cookie,
      headers: { Origin: ORIGIN },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "csrf_rejected" });
  });

  test("refuses an upload attempted through GET", async () => {
    const { cookie } = establishSession();

    const response = await send("/admin/api/media", { cookie });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toContain("POST");
  });

  test("reaches the handler once authenticated, and fails on configuration", async () => {
    // Media configuration is cleared in `beforeEach`, so a fully authorised
    // request gets past the boundary and is refused by the *handler* instead.
    // That is what proves the boundary let it through — the 503 comes from a
    // place only reachable after authentication, CSRF, and origin all passed.
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/api/media", {
      method: "POST",
      cookie,
      headers: { Origin: ORIGIN, "X-CSRF-Token": csrfToken },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "media_not_configured" });
  });

  test("never caches a media response", async () => {
    const response = await send("/admin/api/media/list");

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
