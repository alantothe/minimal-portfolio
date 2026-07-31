/**
 * Database lifecycle for the running server.
 *
 * Startup deliberately does not throw. During this slice the public site is
 * still served entirely from repository content, so a database that fails to
 * open must not take down a site that is otherwise working perfectly. The
 * failure surfaces through readiness instead: `/readyz` reports it, Railway's
 * health check fails the new deployment, and the previous one keeps serving.
 *
 * What must never happen is a silent fallback to ephemeral storage. If the
 * volume is missing, the database is unavailable and says so — it does not
 * quietly open a file in the container's disappearing filesystem.
 */

import type { Database } from "bun:sqlite";
import { resolveDatabaseFile } from "./config";
import { openDatabase } from "./connection";
import { checkDatabaseHealth, type DatabaseHealth } from "./health";
import { runMigrations } from "./migrator";

interface DatabaseState {
  database: Database | null;
  file: string;
  error: string | null;
}

let state: DatabaseState | null = null;

export function initializeDatabase(): DatabaseHealth {
  closeDatabase();

  let file: string;
  try {
    file = resolveDatabaseFile();
  } catch (error) {
    state = { database: null, file: "<unresolved>", error: message(error) };
    return databaseHealth();
  }

  try {
    const database = openDatabase(file);
    const outcome = runMigrations(database);
    state = { database, file, error: null };

    if (outcome.applied.length > 0) {
      console.log(
        `[database] applied migration(s): ${outcome.applied.join(", ")}`
      );
    }
  } catch (error) {
    state = { database: null, file, error: message(error) };
    console.error(`[database] unavailable at ${file}: ${message(error)}`);
  }

  return databaseHealth();
}

/**
 * The open database, for callers that require one.
 *
 * Throws when the database is unavailable rather than returning null, so a
 * future content read cannot accidentally treat "no database" as "no content"
 * and serve an empty page to a Visitor.
 */
export function getDatabase(): Database {
  if (!state?.database) {
    throw new Error(
      `Content database is unavailable${state?.error ? `: ${state.error}` : ""}`
    );
  }

  return state.database;
}

export function isDatabaseAvailable(): boolean {
  return Boolean(state?.database);
}

export function databaseHealth(): DatabaseHealth {
  if (!state) {
    return {
      status: "error",
      file: "<uninitialized>",
      error: "Database has not been initialized",
    };
  }

  if (!state.database) {
    return {
      status: "error",
      file: state.file,
      error: state.error ?? "Database is unavailable",
    };
  }

  return checkDatabaseHealth(state.database, state.file);
}

export function closeDatabase(): void {
  state?.database?.close();
  state = null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { resolveDatabaseFile } from "./config";
export type { DatabaseHealth } from "./health";
