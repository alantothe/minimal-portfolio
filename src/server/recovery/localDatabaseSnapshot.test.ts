import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratedDatabase, seedPublishedSite } from "../published/fixtures";
import {
  createSanitizedDatabaseSnapshot,
  installLocalDatabaseSnapshot,
} from "./localDatabaseSnapshot";
import { validateRecoveryDatabase } from "./recovery";

const directories: string[] = [];
const databases: Database[] = [];

function addAuthenticationState(database: Database): void {
  database
    .query(
      `INSERT INTO oauth_attempts
        (attempt_token_digest, state_digest, pkce_verifier, created_at, expires_at)
       VALUES ('attempt', 'state', 'verifier', '2026-08-22T12:00:00.000Z',
               '2026-08-22T13:00:00.000Z')`
    )
    .run();
  database
    .query(
      `INSERT INTO owner_sessions
        (token_digest, github_user_id, csrf_token, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at)
       VALUES ('session', 42, 'csrf', '2026-08-22T12:00:00.000Z',
               '2026-08-22T12:00:00.000Z', '2026-08-22T13:00:00.000Z',
               '2026-08-23T12:00:00.000Z')`
    )
    .run();
}

function tableCount(file: string, table: string): number {
  const database = new Database(file, { readonly: true, strict: true });
  try {
    const row = database
      .query(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

afterEach(async () => {
  while (databases.length > 0) databases.pop()!.close();
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

describe("local production database snapshot", () => {
  test("copies published data without copying authentication state", async () => {
    const source = migratedDatabase();
    directories.push(source.directory);
    databases.push(source.database);
    seedPublishedSite(source.database);
    addAuthenticationState(source.database);
    const targetDirectory = await mkdtemp(join(tmpdir(), "local-db-copy-"));
    directories.push(targetDirectory);
    const target = join(targetDirectory, "content.sqlite");

    const result = await createSanitizedDatabaseSnapshot({
      sourceDatabaseFile: join(source.directory, "content.sqlite"),
      targetDatabaseFile: target,
    });

    expect(result.invalidatedSessions).toBe(1);
    expect(result.invalidatedOauthAttempts).toBe(1);
    expect(tableCount(target, "owner_sessions")).toBe(0);
    expect(tableCount(target, "oauth_attempts")).toBe(0);
    expect(
      tableCount(join(source.directory, "content.sqlite"), "owner_sessions")
    ).toBe(1);
    expect(validateRecoveryDatabase(target).publishedFingerprint).toBe(
      result.publishedFingerprint
    );
  });

  test("installs verified copy and preserves previous local database", async () => {
    const source = migratedDatabase();
    directories.push(source.directory);
    databases.push(source.database);
    seedPublishedSite(source.database);
    const snapshotDirectory = await mkdtemp(
      join(tmpdir(), "local-db-snapshot-")
    );
    directories.push(snapshotDirectory);
    const downloaded = join(snapshotDirectory, "downloaded.sqlite");
    await createSanitizedDatabaseSnapshot({
      sourceDatabaseFile: join(source.directory, "content.sqlite"),
      targetDatabaseFile: downloaded,
    });

    const local = migratedDatabase();
    directories.push(local.directory);
    seedPublishedSite(local.database, { homeBio: "Local-only content" });
    const previous = validateRecoveryDatabase(
      join(local.directory, "content.sqlite")
    );
    local.database.close();
    const localFile = join(local.directory, "content.sqlite");
    const backupFile = join(
      local.directory,
      "content.sqlite.before-production-pull"
    );

    const installed = await installLocalDatabaseSnapshot({
      downloadedDatabaseFile: downloaded,
      localDatabaseFile: localFile,
      backupDatabaseFile: backupFile,
    });

    expect(validateRecoveryDatabase(localFile).publishedFingerprint).toBe(
      installed.publishedFingerprint
    );
    expect(validateRecoveryDatabase(backupFile).publishedFingerprint).toBe(
      previous.publishedFingerprint
    );
  });
});
