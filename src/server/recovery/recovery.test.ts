import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratedDatabase, seedPublishedSite } from "../published/fixtures";
import {
  RecoveryCoordinator,
  type RecoveryCipher,
  type MediaOriginalSource,
  type RecoveryObject,
  type RecoveryObjectStore,
} from "./recovery";

class MemoryStore implements RecoveryObjectStore {
  readonly objects = new Map<string, RecoveryObject>();
  putDelay: Promise<void> | null = null;
  failWrites = false;

  async put(object: RecoveryObject): Promise<void> {
    await this.putDelay;
    if (this.failWrites) throw new Error("object storage unavailable");
    if (this.objects.has(object.key)) throw new Error("object already exists");
    this.objects.set(object.key, {
      ...object,
      body: object.body.slice(),
      metadata: { ...object.metadata },
    });
  }

  async head(key: string): Promise<Omit<RecoveryObject, "body"> | null> {
    const object = this.objects.get(key);
    return object
      ? { key, bytes: object.body.byteLength, metadata: object.metadata }
      : null;
  }

  async get(key: string): Promise<RecoveryObject | null> {
    const object = this.objects.get(key);
    return object ? { ...object, body: object.body.slice() } : null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}

/** Identity transform: encryption is a true external seam tested by AgeCipher. */
class CopyCipher implements RecoveryCipher {
  async encrypt(input: string, output: string): Promise<void> {
    await copyFile(input, output);
  }

  async decrypt(input: string, output: string): Promise<void> {
    await copyFile(input, output);
  }
}

const directories: string[] = [];
const databases: Database[] = [];

async function fixture() {
  const migrated = migratedDatabase();
  directories.push(migrated.directory);
  databases.push(migrated.database);
  seedPublishedSite(migrated.database);
  const stagingRoot = await mkdtemp(join(tmpdir(), "recovery-test-"));
  directories.push(stagingRoot);
  const store = new MemoryStore();
  const coordinator = new RecoveryCoordinator({
    database: migrated.database,
    databaseFile: join(migrated.directory, "content.sqlite"),
    stagingRoot,
    store,
    cipher: new CopyCipher(),
    recipients: ["age1owner", "age1drill"],
    appCommit: "abc1234",
    clock: () => new Date("2026-08-14T12:34:56.000Z"),
  });
  return { ...migrated, coordinator, store, stagingRoot };
}

afterEach(async () => {
  while (databases.length > 0) databases.pop()!.close();
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

describe("portable database recovery", () => {
  test("restores same published generation and Media references", async () => {
    const { coordinator, database } = await fixture();
    database
      .query(
        `INSERT INTO oauth_attempts
          (attempt_token_digest, state_digest, pkce_verifier, created_at, expires_at)
         VALUES ('attempt', 'state', 'verifier', '2026-08-14T12:00:00.000Z', '2026-08-14T13:00:00.000Z')`
      )
      .run();
    database
      .query(
        `INSERT INTO owner_sessions
          (token_digest, github_user_id, csrf_token, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at)
         VALUES ('session', 42, 'csrf', '2026-08-14T12:00:00.000Z',
                 '2026-08-14T12:00:00.000Z', '2026-08-14T13:00:00.000Z',
                 '2026-08-15T12:00:00.000Z')`
      )
      .run();

    const backup = await coordinator.checkpoint("manual");
    const targetDirectory = await mkdtemp(join(tmpdir(), "restore-target-"));
    directories.push(targetDirectory);
    const restored = await coordinator.restore({
      objectKey: backup.objectKey,
      targetDatabaseFile: join(targetDirectory, "content.sqlite"),
      identityFile: "test-identity.txt",
    });

    expect(restored.publicationGeneration).toBe(backup.publicationGeneration);
    expect(restored.publishedFingerprint).toBe(backup.publishedFingerprint);
    expect(restored.mediaReferences).toEqual(backup.mediaReferences);
    expect(restored.sessionsInvalidated).toBe(true);
    expect(restored.invalidatedSessions).toBe(1);
    expect(restored.invalidatedOauthAttempts).toBe(1);
    expect(coordinator.status().lastSuccessfulDrillAt).toBe(
      "2026-08-14T12:34:56.000Z"
    );
  });

  test("uploads a unique encrypted object and verifies its metadata", async () => {
    const { coordinator, store } = await fixture();

    const backup = await coordinator.checkpoint("hourly");
    const stored = store.objects.get(backup.objectKey);

    expect(backup.objectKey).toMatch(
      /^db\/hourly\/2026\/08\/14\/2026-08-14T12-34-56Z-\d+-[0-9a-f]{12}\.tar\.age$/
    );
    expect(stored?.metadata.sha256).toBe(backup.bundleDigest);
    expect(stored?.body.byteLength).toBeGreaterThan(0);
    expect(coordinator.status().lastSuccessfulBackupAt).toBe(
      "2026-08-14T12:34:56.000Z"
    );
  });

  test("selects newest hourly or daily bundle for an automated drill", async () => {
    const { coordinator } = await fixture();
    const backup = await coordinator.checkpoint("daily");

    expect(await coordinator.latestPortableBackupKey()).toBe(backup.objectKey);
  });

  test("persists backup failures as operational alerts", async () => {
    const { coordinator, store } = await fixture();
    store.failWrites = true;

    await expect(coordinator.checkpoint("hourly")).rejects.toThrow(
      "object storage unavailable"
    );

    expect(coordinator.status().alerts).toContain("backup_failed");
  });

  test("serializes overlapping checkpoints", async () => {
    const { coordinator, store } = await fixture();
    let release!: () => void;
    store.putDelay = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = coordinator.checkpoint("manual");
    const second = coordinator.checkpoint("manual");
    await Bun.sleep(10);

    expect(coordinator.status().running).toBe(true);
    expect(coordinator.status().queued).toBe(1);
    release();
    const [one, two] = await Promise.all([first, second]);

    expect(one.objectKey).not.toBe(two.objectKey);
    expect(coordinator.status()).toMatchObject({ running: false, queued: 0 });
  });

  test("refuses an object whose verified digest was changed", async () => {
    const { coordinator, store } = await fixture();
    const backup = await coordinator.checkpoint("manual");
    const object = store.objects.get(backup.objectKey)!;
    const last = object.body.length - 1;
    object.body[last] = object.body[last]! ^ 1;

    const targetDirectory = await mkdtemp(join(tmpdir(), "restore-target-"));
    directories.push(targetDirectory);

    await expect(
      coordinator.restore({
        objectKey: backup.objectKey,
        targetDatabaseFile: join(targetDirectory, "content.sqlite"),
        identityFile: "test-identity.txt",
      })
    ).rejects.toThrow("encrypted object digest does not match metadata");
  });
});

describe("Media original recovery", () => {
  test("marks original protected only after verified object storage", async () => {
    const { coordinator, store } = await fixture();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const protectedOriginal = await coordinator.protectMediaOriginal({
      mediaId: "asset-card",
      format: "png",
      digest:
        "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
      bytes,
    });

    expect(protectedOriginal.objectKey).toBe(
      "media/original/asset-card/4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6.png.age"
    );
    expect(store.objects.has(protectedOriginal.objectKey)).toBe(true);
    expect(protectedOriginal.verifiedAt).toBe("2026-08-14T12:34:56.000Z");
    expect(coordinator.status().unprotectedMediaIds).not.toContain(
      "asset-card"
    );
  });

  test("reconciles every existing ready original through one source", async () => {
    const { coordinator } = await fixture();
    const bytes = new Uint8Array(64);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const requested: string[] = [];
    const source: MediaOriginalSource = {
      async download(asset) {
        requested.push(asset.id);
        return { bytes, format: "png" };
      },
    };

    const result = await coordinator.reconcileMediaOriginals(source);

    expect(result).toEqual({ protected: 4, failed: 0 });
    expect(requested.sort()).toEqual([
      "asset-card",
      "asset-logo",
      "asset-portrait",
      "asset-sharing",
    ]);
    expect(coordinator.status().unprotectedMediaIds).toEqual([]);
  });
});
