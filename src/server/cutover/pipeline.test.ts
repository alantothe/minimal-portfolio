/**
 * Proof that the request pipeline respects cutover phase.
 *
 * `servePublishedVisitor` can render Ada Lovelace on its own. These tests go
 * through `RequestHandler` so a missed wire-up cannot hide behind a unit that
 * nobody calls.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestHandler } from "../core/requestHandler";
import { Router } from "../core/router";
import { closeDatabase, getDatabase, initializeDatabase } from "../database";
import { SystemStateRepository } from "../database/repository";
import { seedPublishedSite } from "../published/fixtures";
import {
  closePublishedSite,
  initializePublishedSite,
} from "../published/lifecycle";
import { setupRoutes } from "../routes";

const previousDatabaseFile = process.env.CONTENT_DATABASE_FILE;
const directories: string[] = [];

function handler(): RequestHandler {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

function bootPublished(phase: "legacy" | "sqlite-observation"): void {
  const directory = mkdtempSync(join(tmpdir(), "cutover-pipeline-"));
  directories.push(directory);
  process.env.CONTENT_DATABASE_FILE = join(directory, "content.sqlite");
  initializeDatabase();
  seedPublishedSite(getDatabase());
  initializePublishedSite();
  new SystemStateRepository(getDatabase()).setCutoverPhase(phase);
}

afterEach(() => {
  closePublishedSite();
  closeDatabase();
  if (previousDatabaseFile === undefined) {
    delete process.env.CONTENT_DATABASE_FILE;
  } else {
    process.env.CONTENT_DATABASE_FILE = previousDatabaseFile;
  }
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("cutover request pipeline", () => {
  test("legacy keeps Visitors on repository content", async () => {
    bootPublished("legacy");
    const response = await handler().handleRequest(
      new Request("https://example.test/")
    );

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("Ada Lovelace");
  });

  test("sqlite-observation serves the published Home to Visitors", async () => {
    bootPublished("sqlite-observation");
    const response = await handler().handleRequest(
      new Request("https://example.test/")
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Ada Lovelace");
  });

  test("sqlite-observation serves published JSON for Home", async () => {
    bootPublished("sqlite-observation");
    const response = await handler().handleRequest(
      new Request("https://example.test/api/page?name=home")
    );
    const body = (await response.json()) as { content: string };

    expect(response.status).toBe(200);
    expect(body.content).toContain("Ada Lovelace");
    expect(response.headers.get("ETag")).toBeTruthy();
  });

  test("liveness stays independent of the published generation", async () => {
    bootPublished("sqlite-observation");
    const response = await handler().handleRequest(
      new Request("https://example.test/healthz")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
