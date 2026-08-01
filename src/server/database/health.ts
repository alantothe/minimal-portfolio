/**
 * Whether the database is actually usable, not merely open.
 *
 * "Open" is a weak claim: SQLite will happily open a file whose pragmas failed
 * to apply, whose pages are corrupt, or that sits on a volume that never got
 * mounted. The probe therefore checks integrity and reads the durability
 * settings back rather than trusting that startup configured them.
 */

import type { Database } from "bun:sqlite";
import { readPragmas } from "./connection";
import { listAppliedMigrations } from "./migrator";
import { SystemStateRepository, type CutoverPhase } from "./repository";

export interface DatabaseHealth {
  status: "ok" | "error";
  file: string;
  journalMode?: string;
  synchronous?: number;
  foreignKeys?: boolean;
  appliedMigrations?: number;
  cutoverPhase?: CutoverPhase;
  error?: string;
}

export function checkDatabaseHealth(
  database: Database,
  file: string
): DatabaseHealth {
  try {
    // `quick_check` catches structural corruption without the full-scan cost of
    // `integrity_check`, which matters because this runs on every probe.
    const integrity = database.query("PRAGMA quick_check").get() as Record<
      string,
      string
    > | null;
    const result = integrity ? Object.values(integrity)[0] : undefined;

    if (result !== "ok") {
      return {
        status: "error",
        file,
        error: `Integrity check reported "${result ?? "no result"}"`,
      };
    }

    const pragmas = readPragmas(database);
    const migrations = listAppliedMigrations(database);
    const phase = new SystemStateRepository(database).getCutoverPhase();

    if (!pragmas.foreignKeys) {
      return {
        status: "error",
        file,
        error: "Foreign key enforcement is off",
      };
    }

    return {
      status: "ok",
      file,
      journalMode: pragmas.journalMode,
      synchronous: pragmas.synchronous,
      foreignKeys: pragmas.foreignKeys,
      appliedMigrations: migrations.length,
      cutoverPhase: phase,
    };
  } catch (error) {
    return {
      status: "error",
      file,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
