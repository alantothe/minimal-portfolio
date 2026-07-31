import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestHandler } from "../core/requestHandler";
import { Router } from "../core/router";
import { setupRoutes } from "../routes";
import {
  closeDatabase,
  databaseHealth,
  getDatabase,
  initializeDatabase,
  isDatabaseAvailable,
} from "./index";

const previousDatabaseFile = process.env.CONTENT_DATABASE_FILE;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "content-db-lifecycle-"));
  temporaryDirectories.push(directory);
  return directory;
}

function useDatabaseFile(file: string): void {
  process.env.CONTENT_DATABASE_FILE = file;
}

async function readinessResponse(): Promise<Response> {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router).handleRequest(
    new Request("http://portfolio.test/readyz")
  );
}

afterEach(() => {
  closeDatabase();
  if (previousDatabaseFile === undefined) {
    delete process.env.CONTENT_DATABASE_FILE;
  } else {
    process.env.CONTENT_DATABASE_FILE = previousDatabaseFile;
  }
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("startup", () => {
  test("opens the database and migrates it", () => {
    useDatabaseFile(join(temporaryDirectory(), "content.sqlite"));

    const health = initializeDatabase();

    expect(health.status).toBe("ok");
    expect(health.appliedMigrations).toBeGreaterThan(0);
    expect(health.cutoverPhase).toBe("legacy");
    expect(isDatabaseAvailable()).toBe(true);
  });

  test("creates the containing directory when it does not exist", () => {
    useDatabaseFile(join(temporaryDirectory(), "nested", "content.sqlite"));

    expect(initializeDatabase().status).toBe("ok");
  });

  test("is safe to run twice", () => {
    useDatabaseFile(join(temporaryDirectory(), "content.sqlite"));

    initializeDatabase();
    const second = initializeDatabase();

    expect(second.status).toBe("ok");
  });

  test("reports failure instead of throwing when the database cannot open", () => {
    // A file that is not a database stands in for a missing or corrupt volume:
    // startup must degrade to "unready", never crash a site that is serving.
    const file = join(temporaryDirectory(), "content.sqlite");
    writeFileSync(file, "this is not a SQLite database");
    useDatabaseFile(file);

    const health = initializeDatabase();

    expect(health.status).toBe("error");
    expect(health.error).toBeTruthy();
    expect(isDatabaseAvailable()).toBe(false);
  });

  test("an unavailable database refuses reads rather than looking empty", () => {
    const file = join(temporaryDirectory(), "content.sqlite");
    writeFileSync(file, "this is not a SQLite database");
    useDatabaseFile(file);
    initializeDatabase();

    expect(() => getDatabase()).toThrow(/unavailable/);
  });

  test("health before initialization is an error, not a false ok", () => {
    closeDatabase();

    expect(databaseHealth().status).toBe("error");
  });
});

describe("/readyz", () => {
  test("returns 200 when the database is reachable", async () => {
    useDatabaseFile(join(temporaryDirectory(), "content.sqlite"));
    initializeDatabase();

    const response = await readinessResponse();
    const body = (await response.json()) as {
      status: string;
      database: { status: string; cutoverPhase: string };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.database.status).toBe("ok");
    expect(body.database.cutoverPhase).toBe("legacy");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("returns 503 when the database is unavailable", async () => {
    const file = join(temporaryDirectory(), "content.sqlite");
    writeFileSync(file, "this is not a SQLite database");
    useDatabaseFile(file);
    initializeDatabase();

    const response = await readinessResponse();
    const body = (await response.json()) as { status: string };

    // Railway health-checks this route, so a bad deployment fails here and the
    // previous one keeps serving Visitors.
    expect(response.status).toBe(503);
    expect(body.status).toBe("unready");
  });
});

describe("public surface", () => {
  test("/healthz stays a plain liveness check", async () => {
    useDatabaseFile(join(temporaryDirectory(), "content.sqlite"));
    initializeDatabase();

    const router = new Router();
    setupRoutes(router);
    const response = await new RequestHandler(router).handleRequest(
      new Request("http://portfolio.test/healthz")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("no visitor-facing route depends on the database in this slice", async () => {
    // The database is deliberately never initialized here. Every public route
    // must still render, because this slice is dark: nothing reads from SQLite.
    closeDatabase();

    const router = new Router();
    setupRoutes(router);
    const handler = new RequestHandler(router);

    for (const path of ["/", "/about", "/blog", "/projects", "/sitemap.xml"]) {
      const response = await handler.handleRequest(
        new Request(`http://portfolio.test${path}`)
      );
      expect(response.status).toBe(200);
    }
  });
});
