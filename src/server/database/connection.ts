/**
 * Opening the content database with the durability settings this product needs.
 *
 * Published content is durable product data, not a rebuildable cache, so the
 * pragmas here are deliberately conservative:
 *
 * - `foreign_keys=ON` because SQLite defaults it off per connection, and the
 *   revision model depends on referential integrity being enforced.
 * - `journal_mode=WAL` so Visitors can keep reading while a Publication writes.
 * - `synchronous=FULL` so a committed Publication survives an unclean shutdown.
 *   WAL's usual `NORMAL` trades exactly that away, which is the wrong trade for
 *   content the Portfolio owner believes is published.
 * - a finite `busy_timeout` so an unexpectedly long writer produces a
 *   controlled error instead of an indefinite wait.
 *
 * The pragmas are read back after they are set. A pragma that silently failed to
 * apply would leave the database looking healthy while quietly dropping the
 * guarantee it was configured for.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BUSY_TIMEOUT_MS = 5_000;

export interface AppliedPragmas {
  journalMode: string;
  synchronous: number;
  foreignKeys: boolean;
  busyTimeoutMs: number;
}

/** In-memory databases are used by tests and have no directory to create. */
function isFileDatabase(file: string): boolean {
  return file !== ":memory:" && !file.startsWith("file::memory:");
}

export function openDatabase(file: string): Database {
  if (isFileDatabase(file)) {
    // The Railway volume is mounted at /data, but nested paths and the local
    // development directory still have to exist before SQLite will open.
    mkdirSync(dirname(file), { recursive: true });
  }

  const database = new Database(file, { create: true });

  try {
    applyPragmas(database);
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}

function pragma<T>(database: Database, statement: string): T | undefined {
  const row = database.query(`PRAGMA ${statement}`).get() as Record<
    string,
    T
  > | null;
  return row ? Object.values(row)[0] : undefined;
}

export function applyPragmas(database: Database): AppliedPragmas {
  // Order matters: WAL is persisted in the database file, the rest are
  // per-connection and must be set every time a connection is opened.
  pragma(database, "journal_mode = WAL");
  pragma(database, "synchronous = FULL");
  pragma(database, "foreign_keys = ON");
  pragma(database, `busy_timeout = ${BUSY_TIMEOUT_MS}`);

  const applied = readPragmas(database);

  if (applied.journalMode.toLowerCase() !== "wal") {
    throw new Error(
      `Expected WAL journal mode; database reports "${applied.journalMode}"`
    );
  }
  if (!applied.foreignKeys) {
    throw new Error("Expected foreign key enforcement to be enabled");
  }
  if (applied.synchronous !== 2) {
    throw new Error(
      `Expected synchronous=FULL (2); database reports ${applied.synchronous}`
    );
  }

  return applied;
}

export function readPragmas(database: Database): AppliedPragmas {
  return {
    journalMode: String(pragma<string>(database, "journal_mode") ?? ""),
    synchronous: Number(pragma<number>(database, "synchronous") ?? -1),
    foreignKeys: Boolean(pragma<number>(database, "foreign_keys")),
    busyTimeoutMs: Number(pragma<number>(database, "busy_timeout") ?? 0),
  };
}
