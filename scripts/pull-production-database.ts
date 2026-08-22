#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEVELOPMENT_DATABASE_FILE,
  resolveDatabaseFile,
} from "../src/server/database/config";
import {
  createSanitizedDatabaseSnapshot,
  installLocalDatabaseSnapshot,
} from "../src/server/recovery/localDatabaseSnapshot";
import { RAILWAY_PRODUCTION_TARGET } from "../src/shared/railwayTarget";

const projectRoot = resolve(import.meta.dir, "..");
const localDatabaseFile = resolve(projectRoot, DEVELOPMENT_DATABASE_FILE);
const localBackupFile = `${localDatabaseFile}.before-production-pull`;

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RailwayVolume {
  id: string;
  mountPath: string;
  status: string;
}

function usage(): never {
  console.error(`Usage:
  bun run db:pull-local
  bun scripts/pull-production-database.ts export-production <token>`);
  process.exit(2);
}

async function run(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function mustRun(command: string[], failure: string): Promise<string> {
  const result = await run(command);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    const sshHint =
      /permission denied \(publickey\)|no ssh key|ssh key.*(?:not found|not registered)/i.test(
        detail
      )
        ? " Register your local key once with: railway ssh keys add"
        : "";
    throw new Error(`${failure}.${sshHint}${detail ? `\n${detail}` : ""}`);
  }
  return result.stdout.trim();
}

async function assertLocalDatabaseIsIdle(): Promise<void> {
  if (!(await Bun.file(localDatabaseFile).exists())) return;
  const lsof = Bun.which("lsof");
  if (!lsof) {
    throw new Error(
      "Cannot prove local database is closed because lsof is unavailable"
    );
  }
  const result = await run([
    lsof,
    "-t",
    "--",
    localDatabaseFile,
    `${localDatabaseFile}-wal`,
    `${localDatabaseFile}-shm`,
  ]);
  if (result.exitCode === 0 && result.stdout.trim()) {
    throw new Error(
      "Local database is in use. Stop `bun run dev`, then run this command again"
    );
  }
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error("Could not check whether local database is in use");
  }
}

function productionDatabaseDirectory(): string {
  return dirname(resolveDatabaseFile({ NODE_ENV: "production" }));
}

async function productionVolumeId(): Promise<string> {
  const output = await mustRun(
    [
      "railway",
      "volume",
      "--project",
      RAILWAY_PRODUCTION_TARGET.project,
      "--environment",
      RAILWAY_PRODUCTION_TARGET.environment,
      "--service",
      RAILWAY_PRODUCTION_TARGET.service,
      "list",
      "--json",
    ],
    "Could not list Railway production volumes"
  );
  const parsed = JSON.parse(output) as { volumes?: RailwayVolume[] };
  const productionDirectory = productionDatabaseDirectory();
  const matches = (parsed.volumes ?? []).filter(
    (volume) =>
      volume.mountPath === productionDirectory && volume.status === "Ready"
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ready Railway volume mounted at ${productionDirectory}; found ${matches.length}`
    );
  }
  return matches[0]!.id;
}

async function exportProduction(token: string | undefined): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Production snapshot export requires NODE_ENV=production");
  }
  if (!token || !/^[a-f0-9]{32}$/.test(token)) usage();

  const sourceDatabaseFile = resolveDatabaseFile();
  const targetDatabaseFile = join(
    dirname(sourceDatabaseFile),
    ".local-pulls",
    `${token}.sqlite`
  );
  const result = await createSanitizedDatabaseSnapshot({
    sourceDatabaseFile,
    targetDatabaseFile,
  });
  console.log(
    JSON.stringify({
      status: "ready",
      publicationGeneration: result.publicationGeneration,
      publishedFingerprint: result.publishedFingerprint,
      bytes: result.bytes,
      invalidatedSessions: result.invalidatedSessions,
      invalidatedOauthAttempts: result.invalidatedOauthAttempts,
    })
  );
}

async function pullLocal(): Promise<void> {
  if (!Bun.which("railway")) throw new Error("Railway CLI is required");
  await assertLocalDatabaseIsIdle();
  await mustRun(["railway", "whoami"], "Railway CLI is not authenticated");
  const volumeId = await productionVolumeId();
  const token = randomBytes(16).toString("hex");
  // Railway's file API addresses paths from volume root, not mount path.
  const remoteFile = `/.local-pulls/${token}.sqlite`;
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "portfolio-local-database-")
  );
  const downloadedFile = join(temporaryDirectory, "content.sqlite");
  let snapshotCreated = false;
  let pullSucceeded = false;

  console.log("[local-db] creating sanitized production snapshot...");
  try {
    await mustRun(
      [
        "railway",
        "ssh",
        "--project",
        RAILWAY_PRODUCTION_TARGET.project,
        "--environment",
        RAILWAY_PRODUCTION_TARGET.environment,
        "--service",
        RAILWAY_PRODUCTION_TARGET.service,
        "bun",
        "scripts/pull-production-database.ts",
        "export-production",
        token,
      ],
      "Could not create production snapshot"
    );
    snapshotCreated = true;

    console.log("[local-db] downloading snapshot...");
    await mustRun(
      [
        "railway",
        "volume",
        "files",
        "--volume",
        volumeId,
        "download",
        remoteFile,
        downloadedFile,
        "--json",
      ],
      "Could not download production snapshot"
    );

    const result = await installLocalDatabaseSnapshot({
      downloadedDatabaseFile: downloadedFile,
      localDatabaseFile,
      backupDatabaseFile: localBackupFile,
    });
    console.log(
      `[local-db] local database refreshed (generation ${result.publicationGeneration}).`
    );
    console.log(`[local-db] previous local copy: ${localBackupFile}`);
    console.log("[local-db] next: bun run dev");
    pullSucceeded = true;
  } finally {
    const cleanup = await run([
      "railway",
      "volume",
      "files",
      "--volume",
      volumeId,
      "delete",
      remoteFile,
      "--yes",
      "--json",
    ]);
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (snapshotCreated && cleanup.exitCode !== 0) {
      const message =
        "Temporary Railway snapshot cleanup failed; remove it from volume path /.local-pulls";
      if (pullSucceeded) throw new Error(message);
      console.error(`[local-db] cleanup_warning: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const [command, token, ...extra] = process.argv.slice(2);
  if (extra.length > 0) usage();
  if (command === "export-production") {
    await exportProduction(token);
    return;
  }
  if (command) usage();
  await pullLocal();
}

main().catch((error) => {
  console.error(
    `[local-db] pull_failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
