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
import { seedPublishedSite, seedSite } from "../published/fixtures";
import { buildSiteSnapshot } from "../published/snapshot";
import { SINGLETON_IDS, importedContentId } from "../content/identity";
import { ContentRepository } from "../database/contentRepository";
import { PublicationRepository } from "../database/publicationRepository";
import { SystemStateRepository } from "../database/repository";

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
    const response = await send("/admin/api/content/missing");

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
  test.each(["/admin", "/admin/login", "/admin/api/content/missing"])(
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

  test("opens the requested Project in the collection editor", async () => {
    seedSite(getDatabase());
    const projectId = importedContentId("project", "questurian");
    const { cookie } = establishSession();

    const response = await send(
      `/admin?content=${encodeURIComponent(projectId)}`,
      { cookie }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(`data-content-id="${projectId}"`);
    expect(body).toContain('data-content-type="project"');
    expect(body).toContain('name="card.mediaAssetId"');
    expect(body).toContain('name="summary"');
    expect(body).not.toContain('name="role"');
    expect(body).toContain('name="slug"');
    expect(body).toContain('name="displayOrder"');
  });

  test("keeps a collection item selected while previewing its ordering page", async () => {
    seedSite(getDatabase());
    const projectId = importedContentId("project", "questurian");
    const { cookie } = establishSession();

    const response = await send(
      `/admin?content=${encodeURIComponent(projectId)}&preview=%2Fprojects`,
      { cookie }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(`data-content-id="${projectId}"`);
    expect(body).toContain('src="/admin/preview?route=%2Fprojects"');
  });

  test("opens Project and Blog post creation with collection previews", async () => {
    seedSite(getDatabase());
    const { cookie } = establishSession();

    const project = await send("/admin?new=project", { cookie });
    const projectBody = await project.text();
    expect(projectBody).toContain('id="collection-create"');
    expect(projectBody).toContain('data-content-type="project"');
    expect(projectBody).toContain("Create Project");
    expect(projectBody).toContain('src="/admin/preview?route=%2Fprojects"');

    const blog = await send("/admin?new=blog_post", { cookie });
    const blogBody = await blog.text();
    expect(blogBody).toContain('data-content-type="blog_post"');
    expect(blogBody).toContain("Create Blog post");
    expect(blogBody).toContain('src="/admin/preview?route=%2Fblog"');
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

describe("Content draft API", () => {
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
        draftVersion: number;
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
        expectedDraftVersion: current.draft.draftVersion,
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
        expectedDraftVersion: current.draft.draftVersion,
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
      draft: {
        updatedAt: string;
        draftVersion: number;
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
        expectedDraftVersion: current.draft.draftVersion,
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

  test("autosaves Project content, Public route slug, and display order", async () => {
    seedSite(getDatabase());
    const projectId = importedContentId("project", "questurian");
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(projectId)}`;
    const read = await send(path, { cookie });
    const current = (await read.json()) as {
      draft: {
        updatedAt: string;
        draftVersion: number;
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
        expectedDraftVersion: current.draft.draftVersion,
        data: { ...current.draft.data, title: "Updated project" },
        attributes: { slug: "updated-project", displayOrder: 9 },
      }),
    });
    const body = (await response.json()) as {
      draft: { slug: string; displayOrder: number };
    };
    const stored = new ContentRepository(getDatabase()).findById(projectId)!;

    expect(response.status).toBe(200);
    expect(body.draft.slug).toBe("updated-project");
    expect(body.draft.displayOrder).toBe(9);
    expect((stored.data as { title: string }).title).toBe("Updated project");
    expect(stored.slug).toBe("updated-project");
    expect(stored.displayOrder).toBe(9);

    const preview = await send(
      "/admin/preview?route=%2Fprojects%2Fupdated-project",
      { cookie }
    );
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain("Updated project");
  });

  test("rejects unknown collection metadata before changing a draft", async () => {
    seedSite(getDatabase());
    const projectId = importedContentId("project", "questurian");
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(projectId)}`;
    const repository = new ContentRepository(getDatabase());
    const before = repository.findById(projectId)!;

    const response = await send(path, {
      method: "PUT",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedDraftVersion: before.draftVersion,
        data: before.data,
        attributes: {
          slug: "changed-project",
          displayOrder: 5,
          arbitraryAddress: "/surprise",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(repository.findById(projectId)).toEqual(before);
  });

  test("rejects collection metadata with the wrong JSON shape", async () => {
    seedSite(getDatabase());
    const projectId = importedContentId("project", "questurian");
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(projectId)}`;
    const before = new ContentRepository(getDatabase()).findById(projectId)!;

    const response = await send(path, {
      method: "PUT",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expectedDraftVersion: before.draftVersion,
        data: before.data,
        attributes: { slug: ["not", "a", "slug"], displayOrder: 1 },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(new ContentRepository(getDatabase()).findById(projectId)).toEqual(
      before
    );
  });
});

describe("publication API", () => {
  test("publishes and lists immutable history only after the cutover is sealed", async () => {
    seedSite(getDatabase());
    const content = new ContentRepository(getDatabase());
    const publication = new PublicationRepository(getDatabase());
    for (const type of [
      "home",
      "about",
      "branding",
      "project",
      "blog_post",
    ] as const) {
      for (const item of content.list(type)) {
        publication.seedMigrationRevision(
          item,
          new Date("2026-08-01T12:00:00.000Z")
        );
      }
    }
    const home = content.findById(SINGLETON_IDS.home)!;
    const edited = content.updateIfDraftVersion(
      home.id,
      {
        data: {
          ...(home.data as Record<string, unknown>),
          professionalTitle: "Published through HTTP",
        },
      },
      "owner",
      home.draftVersion
    );
    if (edited.status !== "updated") throw new Error("fixture edit failed");
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(home.id)}/publish`;
    const request = () =>
      send(path, {
        method: "POST",
        cookie,
        headers: {
          Origin: ORIGIN,
          "X-CSRF-Token": csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedDraftVersion: edited.item.draftVersion,
          idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        }),
      });

    expect((await request()).status).toBe(409);
    new SystemStateRepository(getDatabase()).setCutoverPhase("sealed");
    expect((await request()).status).toBe(201);

    const history = await send(
      `/admin/api/content/${encodeURIComponent(home.id)}/history`,
      { cookie }
    );
    expect(history.status).toBe(200);
    expect((await history.json()).revisions).toHaveLength(2);
  });
});

describe("collection lifecycle API", () => {
  test("requires the same Owner, Origin, and CSRF boundary", async () => {
    expect(
      (
        await send("/admin/api/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "project", title: "New", slug: "new" }),
        })
      ).status
    ).toBe(401);

    const { cookie, csrfToken } = establishSession();
    const noOrigin = await send("/admin/api/content", {
      method: "POST",
      cookie,
      headers: {
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "project", title: "New", slug: "new" }),
    });
    expect(noOrigin.status).toBe(403);
  });

  test("suggests and confirms a collision-safe slug before creating", async () => {
    seedSite(getDatabase());
    const repository = new ContentRepository(getDatabase());
    const before = repository.list("project").length;
    const { cookie, csrfToken } = establishSession();
    const headers = {
      Origin: ORIGIN,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json",
    };

    const suggestion = await send("/admin/api/content", {
      method: "POST",
      cookie,
      headers,
      body: JSON.stringify({
        type: "project",
        title: "Fresh Project",
        slug: "",
      }),
    });
    expect(suggestion.status).toBe(200);
    expect(await suggestion.json()).toEqual({
      status: "confirmation_required",
      suggestedSlug: "fresh-project",
      reason: "generated",
    });
    expect(repository.list("project")).toHaveLength(before);

    const created = await send("/admin/api/content", {
      method: "POST",
      cookie,
      headers,
      body: JSON.stringify({
        type: "project",
        title: "Fresh Project",
        slug: "fresh-project",
      }),
    });
    const body = (await created.json()) as {
      status: string;
      content: { id: string; type: string; route: string };
    };
    expect(created.status).toBe(201);
    expect(body.status).toBe("created");
    expect(body.content.type).toBe("project");
    expect(body.content.route).toBe("/projects/fresh-project");
    expect(repository.findById(body.content.id)?.origin).toBe("owner");

    const workspace = await send(
      `/admin?content=${encodeURIComponent(body.content.id)}`,
      { cookie }
    );
    const workspaceBody = await workspace.text();
    expect(workspaceBody).toContain(`data-content-id="${body.content.id}"`);
    expect(workspaceBody).toContain(
      'src="/admin/preview?route=%2Fprojects%2Ffresh-project"'
    );
  });

  test("returns a numbered suggestion for a reserved collection slug", async () => {
    seedSite(getDatabase());
    const { cookie, csrfToken } = establishSession();

    const response = await send("/admin/api/content", {
      method: "POST",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "project",
        title: "Questurian copy",
        slug: "questurian",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "confirmation_required",
      suggestedSlug: "questurian-2",
      reason: "collision",
    });
  });

  test("strictly rejects unknown creation fields and types", async () => {
    const { cookie, csrfToken } = establishSession();
    const headers = {
      Origin: ORIGIN,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json",
    };

    const unknownField = await send("/admin/api/content", {
      method: "POST",
      cookie,
      headers,
      body: JSON.stringify({
        type: "project",
        title: "Project",
        slug: "project",
        arbitrary: true,
      }),
    });
    expect(unknownField.status).toBe(400);

    const singleton = await send("/admin/api/content", {
      method: "POST",
      cookie,
      headers,
      body: JSON.stringify({ type: "home", title: "Another Home" }),
    });
    expect(singleton.status).toBe(400);
    expect(new ContentRepository(getDatabase()).countByType()).toEqual({});
  });

  test("deletes a current collection draft but keeps its identity and route reserved", async () => {
    seedSite(getDatabase());
    const repository = new ContentRepository(getDatabase());
    const project = repository.findById(
      importedContentId("project", "questurian")
    )!;
    const { cookie, csrfToken } = establishSession();
    const path = `/admin/api/content/${encodeURIComponent(project.id)}`;

    const response = await send(path, {
      method: "DELETE",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedUpdatedAt: project.updatedAt }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "deleted",
      route: "/projects",
    });
    expect(repository.findById(project.id)).toBeNull();
    expect(
      repository.findIncludingArchivedById(project.id)?.deletedAt
    ).not.toBeNull();
    expect(repository.list("project").map((item) => item.id)).not.toContain(
      project.id
    );
    expect(repository.takenSlugs("project")).toContain("questurian");
    expect((await send(path, { cookie })).status).toBe(404);
    expect(
      (await send("/admin/preview?route=%2Fprojects%2Fquesturian", { cookie }))
        .status
    ).toBe(404);
  });

  test("refuses singleton and stale collection deletion", async () => {
    seedSite(getDatabase());
    const repository = new ContentRepository(getDatabase());
    const home = repository.findById(SINGLETON_IDS.home)!;
    const project = repository.findById(
      importedContentId("project", "questurian")
    )!;
    repository.update(
      project.id,
      { data: project.data },
      "owner",
      new Date(Date.parse(project.updatedAt) + 1_000)
    );
    const { cookie, csrfToken } = establishSession();
    const headers = {
      Origin: ORIGIN,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json",
    };

    const singleton = await send(
      `/admin/api/content/${encodeURIComponent(home.id)}`,
      {
        method: "DELETE",
        cookie,
        headers,
        body: JSON.stringify({ expectedUpdatedAt: home.updatedAt }),
      }
    );
    expect(singleton.status).toBe(422);

    const stale = await send(
      `/admin/api/content/${encodeURIComponent(project.id)}`,
      {
        method: "DELETE",
        cookie,
        headers,
        body: JSON.stringify({ expectedUpdatedAt: project.updatedAt }),
      }
    );
    expect(stale.status).toBe(409);
    expect(repository.findById(project.id)?.deletedAt).toBeNull();
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

describe("Project ordering API", () => {
  test("publishes current Project order through the protected mutation boundary", async () => {
    seedPublishedSite(getDatabase());
    new SystemStateRepository(getDatabase()).setCutoverPhase("sealed");
    const content = new ContentRepository(getDatabase());
    const moved = content.findBySlug("project", "minimal-portfolio")!;

    expect(
      (
        await send("/admin/api/projects/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: moved.id, direction: "up" }),
        })
      ).status
    ).toBe(401);

    const { cookie, csrfToken } = establishSession();
    const moveResponse = await send("/admin/api/projects/order", {
      method: "POST",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: moved.id, direction: "up" }),
    });

    expect(moveResponse.status).toBe(200);
    expect(await moveResponse.json()).toMatchObject({ status: "moved" });
    expect(content.list("project").map((item) => item.slug)).toEqual([
      "minimal-portfolio",
      "questurian",
    ]);
    const publishResponse = await send("/admin/api/projects/order", {
      method: "POST",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "publish" }),
    });
    expect(publishResponse.status).toBe(200);
    expect(await publishResponse.json()).toMatchObject({ status: "published" });
    const published = buildSiteSnapshot(getDatabase(), {
      cloudName: "fixture-cloud",
    });
    expect(published.status).toBe("built");
    if (published.status === "built") {
      expect(
        published.snapshot.projects.map((project) => project.slug)
      ).toEqual(["minimal-portfolio", "questurian"]);
    }
  });

  test("strictly rejects malformed ordering actions", async () => {
    const { cookie, csrfToken } = establishSession();
    const response = await send("/admin/api/projects/order", {
      method: "POST",
      cookie,
      headers: {
        Origin: ORIGIN,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "project-id", direction: "sideways" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
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
