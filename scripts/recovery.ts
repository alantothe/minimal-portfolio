#!/usr/bin/env bun

import { openDatabase } from "../src/server/database/connection";
import { checkDatabaseHealth } from "../src/server/database/health";
import {
  migratedDatabase,
  seedPublishedSite,
} from "../src/server/published/fixtures";
import {
  AgeCipher,
  DirectoryObjectStore,
  R2ObjectStore,
} from "../src/server/recovery/adapters";
import {
  resolveRecoveryConfig,
  type RecoveryConfig,
} from "../src/server/recovery/config";
import {
  RecoveryCoordinator,
  type BackupKind,
} from "../src/server/recovery/recovery";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function usage(): never {
  console.error(`Usage:
  bun scripts/recovery.ts status
  bun scripts/recovery.ts checkpoint [hourly|daily|monthly|pre-change|manual] [--change-id <id>]
  bun scripts/recovery.ts restore --object <key> --target <file> --identity <file> [--operator]
  bun scripts/recovery.ts drill-latest --target <file> --identity <file>
  bun scripts/recovery.ts fixture-drill`);
  process.exit(2);
}

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : null;
}

function configured(): RecoveryConfig {
  const resolution = resolveRecoveryConfig();
  if (resolution.status !== "configured") {
    throw new Error(
      resolution.status === "invalid"
        ? resolution.reason
        : "Recovery is not configured"
    );
  }
  return resolution.config;
}

function liveCoordinator(config: RecoveryConfig) {
  const database = openDatabase(config.databaseFile);
  const health = checkDatabaseHealth(database, config.databaseFile);
  if (health.status !== "ok") {
    database.close();
    throw new Error("Content database is not healthy");
  }
  return {
    database,
    coordinator: new RecoveryCoordinator({
      database,
      databaseFile: config.databaseFile,
      stagingRoot: config.stagingRoot,
      store: new R2ObjectStore({
        endpoint: config.endpoint,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      }),
      cipher: new AgeCipher(),
      recipients: config.recipients,
      appCommit: config.appCommit,
    }),
  };
}

async function commandOutput(command: string[]): Promise<string> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command[0]} failed (${exitCode})`);
  return stdout.trim();
}

async function fixtureDrill(): Promise<void> {
  const started = Date.now();
  const directory = await mkdtemp(join(tmpdir(), "portfolio-recovery-drill-"));
  const migrated = migratedDatabase();
  try {
    seedPublishedSite(migrated.database);
    const ownerIdentity = join(directory, "owner.identity");
    const drillIdentity = join(directory, "drill.identity");
    await commandOutput(["age-keygen", "-o", ownerIdentity]);
    await commandOutput(["age-keygen", "-o", drillIdentity]);
    const recipients = [
      await commandOutput(["age-keygen", "-y", ownerIdentity]),
      await commandOutput(["age-keygen", "-y", drillIdentity]),
    ];
    const store = new DirectoryObjectStore(join(directory, "objects"));
    const coordinator = new RecoveryCoordinator({
      database: migrated.database,
      databaseFile: join(migrated.directory, "content.sqlite"),
      stagingRoot: join(directory, "staging"),
      store,
      cipher: new AgeCipher(),
      recipients,
      appCommit: process.env.GITHUB_SHA?.trim() || "fixture-drill",
    });
    const backup = await coordinator.checkpoint("manual");
    const restored = await coordinator.restore({
      objectKey: backup.objectKey,
      targetDatabaseFile: join(directory, "restored", "content.sqlite"),
      identityFile: drillIdentity,
      drillKind: "automated",
    });
    console.log(
      JSON.stringify({
        status: "passed",
        publicationGeneration: restored.publicationGeneration,
        publishedFingerprint: restored.publishedFingerprint,
        mediaReferences: restored.mediaReferences.length,
        sessionsInvalidated: restored.sessionsInvalidated,
        durationMs: Date.now() - started,
      })
    );
  } finally {
    migrated.database.close();
    await rm(migrated.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") usage();
  if (command === "fixture-drill") {
    await fixtureDrill();
    return;
  }

  const config = configured();
  const { database, coordinator } = liveCoordinator(config);
  try {
    if (command === "status") {
      console.log(JSON.stringify(coordinator.status()));
      return;
    }
    if (command === "checkpoint") {
      const kind = (args[0] ?? "manual") as BackupKind;
      if (
        !["hourly", "daily", "monthly", "pre-change", "manual"].includes(kind)
      )
        usage();
      const changeId = option(args, "--change-id");
      console.log(
        JSON.stringify(
          await coordinator.checkpoint(kind, changeId ? { changeId } : {})
        )
      );
      return;
    }
    if (command === "restore" || command === "drill-latest") {
      const target = option(args, "--target");
      const identity = option(args, "--identity");
      const objectKey =
        command === "restore"
          ? option(args, "--object")
          : await coordinator.latestPortableBackupKey();
      if (!target || !identity || !objectKey) usage();
      if (!isAbsolute(target)) {
        throw new Error("Restore target must be an absolute isolated path");
      }
      if (resolve(target) === resolve(config.databaseFile)) {
        throw new Error("Refusing to restore over the live content database");
      }
      console.log(
        JSON.stringify(
          await coordinator.restore({
            objectKey,
            targetDatabaseFile: target,
            identityFile: identity,
            drillKind: args.includes("--operator") ? "operator" : "automated",
          })
        )
      );
      return;
    }
    usage();
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(
    `[recovery] command_failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
});
