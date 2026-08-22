import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { openDatabase } from "../database/connection";
import {
  validateRecoveryDatabase,
  type RecoveryDatabaseValidation,
} from "./recovery";

export interface SanitizedSnapshotResult extends RecoveryDatabaseValidation {
  bytes: number;
  invalidatedSessions: number;
  invalidatedOauthAttempts: number;
}

async function ensureMissing(file: string): Promise<void> {
  try {
    await access(file);
  } catch {
    return;
  }
  throw new Error(`Snapshot target already exists: ${file}`);
}

function count(database: Database, table: string): number {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table name");
  const row = database
    .query(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number } | null;
  return Number(row?.count ?? 0);
}

/**
 * Creates an application-consistent copy while production remains online.
 * Authentication state is removed from the copy only; source rows are untouched.
 */
export async function createSanitizedDatabaseSnapshot(input: {
  sourceDatabaseFile: string;
  targetDatabaseFile: string;
}): Promise<SanitizedSnapshotResult> {
  const source = resolve(input.sourceDatabaseFile);
  const target = resolve(input.targetDatabaseFile);
  if (source === target) {
    throw new Error("Snapshot target must differ from source database");
  }

  await ensureMissing(target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const [sourceStats, targetFilesystem] = await Promise.all([
    stat(source),
    statfs(dirname(target)),
  ]);
  const requiredBytes = Math.max(sourceStats.size * 2, 1024 * 1024);
  const availableBytes = targetFilesystem.bavail * targetFilesystem.bsize;
  if (availableBytes < requiredBytes) {
    throw new Error("Insufficient space for local database snapshot");
  }

  const sourceDatabase = openDatabase(source);
  try {
    sourceDatabase.query("VACUUM INTO ?").run(target);
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  } finally {
    sourceDatabase.close();
  }

  try {
    const before = validateRecoveryDatabase(target);
    const snapshot = new Database(target, { strict: true });
    let invalidatedSessions = 0;
    let invalidatedOauthAttempts = 0;
    try {
      snapshot.exec("PRAGMA foreign_keys = ON");
      invalidatedSessions = count(snapshot, "owner_sessions");
      invalidatedOauthAttempts = count(snapshot, "oauth_attempts");
      snapshot.transaction(() => {
        snapshot.exec("DELETE FROM owner_sessions");
        snapshot.exec("DELETE FROM oauth_attempts");
      })();
      snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      snapshot.close();
    }

    const after = validateRecoveryDatabase(target);
    if (after.publishedFingerprint !== before.publishedFingerprint) {
      throw new Error("Authentication cleanup changed published content");
    }
    await chmod(target, 0o600);
    return {
      ...after,
      bytes: (await stat(target)).size,
      invalidatedSessions,
      invalidatedOauthAttempts,
    };
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}

/** Installs a verified download and keeps one recoverable local predecessor. */
export async function installLocalDatabaseSnapshot(input: {
  downloadedDatabaseFile: string;
  localDatabaseFile: string;
  backupDatabaseFile: string;
}): Promise<RecoveryDatabaseValidation> {
  const downloaded = resolve(input.downloadedDatabaseFile);
  const local = resolve(input.localDatabaseFile);
  const backup = resolve(input.backupDatabaseFile);
  if (new Set([downloaded, local, backup]).size !== 3) {
    throw new Error("Downloaded, local, and backup database paths must differ");
  }

  const validation = validateRecoveryDatabase(downloaded);
  const downloadedDatabase = new Database(downloaded, {
    readonly: true,
    strict: true,
  });
  try {
    if (
      count(downloadedDatabase, "owner_sessions") !== 0 ||
      count(downloadedDatabase, "oauth_attempts") !== 0
    ) {
      throw new Error(
        "Downloaded database still contains authentication state"
      );
    }
  } finally {
    downloadedDatabase.close();
  }

  await mkdir(dirname(local), { recursive: true });
  if (await Bun.file(local).exists()) {
    const pendingBackup = `${backup}.pending-${randomBytes(4).toString("hex")}`;
    await rm(pendingBackup, { force: true });
    try {
      const current = openDatabase(local);
      try {
        current.query("VACUUM INTO ?").run(pendingBackup);
      } finally {
        current.close();
      }
      await rm(backup, { force: true });
      await rename(pendingBackup, backup);
      await chmod(backup, 0o600);
    } catch (error) {
      await rm(pendingBackup, { force: true });
      throw error;
    }
  }

  const pendingLocal = `${local}.pending-${randomBytes(4).toString("hex")}`;
  await rm(pendingLocal, { force: true });
  try {
    await copyFile(downloaded, pendingLocal);
    await chmod(pendingLocal, 0o600);
    await rm(`${local}-wal`, { force: true });
    await rm(`${local}-shm`, { force: true });
    await rename(pendingLocal, local);
  } catch (error) {
    await rm(pendingLocal, { force: true });
    throw error;
  }
  return validation;
}
