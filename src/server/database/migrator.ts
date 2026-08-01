/**
 * Applies pending migrations on startup, once, in order, transactionally.
 *
 * Each migration runs inside its own transaction, so a failure leaves the
 * database on the last complete schema rather than half-way through one. The
 * ledger row is written in that same transaction: a migration that applied but
 * failed to record itself would be re-applied on the next boot.
 */

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { MIGRATIONS, type Migration } from "./migrations";

export interface AppliedMigration {
  id: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationOutcome {
  applied: number[];
  alreadyApplied: number[];
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

export function checksumOf(migration: Migration): string {
  return createHash("sha256")
    .update(migration.statements.join(";"))
    .digest("hex");
}

export function listAppliedMigrations(database: Database): AppliedMigration[] {
  database.exec(LEDGER);
  return database
    .query(
      "SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id"
    )
    .all() as AppliedMigration[];
}

export function runMigrations(
  database: Database,
  migrations: Migration[] = MIGRATIONS
): MigrationOutcome {
  assertOrderedAndUnique(migrations);
  database.exec(LEDGER);

  const applied = new Map(
    listAppliedMigrations(database).map((row) => [row.id, row])
  );

  const outcome: MigrationOutcome = { applied: [], alreadyApplied: [] };

  for (const migration of migrations) {
    const previous = applied.get(migration.id);
    const checksum = checksumOf(migration);

    if (previous) {
      if (previous.checksum !== checksum) {
        throw new Error(
          `Migration ${migration.id} (${migration.name}) was modified after it was applied. Migrations are append-only: add a new migration instead of editing a shipped one.`
        );
      }
      outcome.alreadyApplied.push(migration.id);
      continue;
    }

    applyOne(database, migration, checksum);
    outcome.applied.push(migration.id);
  }

  assertNoUnknownMigrations(migrations, applied);

  return outcome;
}

function applyOne(
  database: Database,
  migration: Migration,
  checksum: string
): void {
  const apply = database.transaction(() => {
    for (const statement of migration.statements) {
      database.exec(statement);
    }
    database
      .query(
        `INSERT INTO schema_migrations (id, name, checksum, applied_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
      )
      .run(migration.id, migration.name, checksum);
  });

  try {
    apply();
  } catch (error) {
    throw new Error(
      `Migration ${migration.id} (${migration.name}) failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

function assertOrderedAndUnique(migrations: Migration[]): void {
  const seen = new Set<number>();
  let previousId = 0;

  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id ${migration.id}`);
    }
    if (migration.id <= previousId) {
      throw new Error(
        `Migration ids must ascend; ${migration.id} follows ${previousId}`
      );
    }
    seen.add(migration.id);
    previousId = migration.id;
  }
}

/**
 * A database carrying migrations this release has never heard of is almost
 * always a rollback onto an older image. Continuing would run old code against
 * a newer schema, so stop and let readiness fail instead.
 */
function assertNoUnknownMigrations(
  migrations: Migration[],
  applied: Map<number, AppliedMigration>
): void {
  const known = new Set(migrations.map((migration) => migration.id));
  const unknown = [...applied.keys()].filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new Error(
      `Database has migrations this release does not know about: ${unknown.join(", ")}. This usually means an older image was deployed onto a newer database.`
    );
  }
}
