import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEVELOPMENT_DATABASE_FILE,
  PRODUCTION_DATABASE_FILE,
  resolveDatabaseFile,
} from "./config";
import { BUSY_TIMEOUT_MS, openDatabase, readPragmas } from "./connection";
import { checkDatabaseHealth } from "./health";
import { MIGRATIONS, type Migration } from "./migrations";
import { checksumOf, listAppliedMigrations, runMigrations } from "./migrator";
import { SystemStateRepository } from "./repository";
import { seedSite } from "../published/fixtures";
import { PublicationRepository } from "./publicationRepository";

const temporaryDirectories: string[] = [];

function temporaryDatabaseFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "content-db-"));
  temporaryDirectories.push(directory);
  return join(directory, "content.sqlite");
}

function migratedDatabase(): { database: Database; file: string } {
  const file = temporaryDatabaseFile();
  const database = openDatabase(file);
  runMigrations(database);
  return { database, file };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("database location", () => {
  test("defaults to the persistent volume in production", () => {
    expect(resolveDatabaseFile({ NODE_ENV: "production" })).toBe(
      PRODUCTION_DATABASE_FILE
    );
    expect(PRODUCTION_DATABASE_FILE.startsWith("/data/")).toBe(true);
  });

  test("defaults to a local file outside production", () => {
    expect(resolveDatabaseFile({})).toBe(DEVELOPMENT_DATABASE_FILE);
  });

  test("honours an explicit absolute path", () => {
    expect(
      resolveDatabaseFile({
        NODE_ENV: "production",
        CONTENT_DATABASE_FILE: "/data/other.sqlite",
      })
    ).toBe("/data/other.sqlite");
  });

  test("refuses a relative path in production", () => {
    // A relative path resolves inside the container's ephemeral filesystem,
    // which loses every Publication on the next deploy.
    expect(() =>
      resolveDatabaseFile({
        NODE_ENV: "production",
        CONTENT_DATABASE_FILE: "./content.sqlite",
      })
    ).toThrow(/absolute path/);
  });
});

describe("connection durability", () => {
  test("applies WAL, synchronous=FULL, foreign keys, and a busy timeout", () => {
    const file = temporaryDatabaseFile();
    const database = openDatabase(file);

    const pragmas = readPragmas(database);

    expect(pragmas.journalMode.toLowerCase()).toBe("wal");
    expect(pragmas.synchronous).toBe(2);
    expect(pragmas.foreignKeys).toBe(true);
    expect(pragmas.busyTimeoutMs).toBe(BUSY_TIMEOUT_MS);

    database.close();
  });

  test("foreign keys are actually enforced, not just reported on", () => {
    const file = temporaryDatabaseFile();
    const database = openDatabase(file);

    database.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    database.exec(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))"
    );

    expect(() =>
      database.query("INSERT INTO child (id, parent_id) VALUES (1, 999)").run()
    ).toThrow();

    database.close();
  });

  test("WAL survives reopening the same file", () => {
    const file = temporaryDatabaseFile();
    openDatabase(file).close();

    const reopened = openDatabase(file);
    expect(readPragmas(reopened).journalMode.toLowerCase()).toBe("wal");
    reopened.close();
  });
});

describe("migrations", () => {
  test("seeds existing imported content as immutable revision one", () => {
    const database = openDatabase(temporaryDatabaseFile());
    runMigrations(database, MIGRATIONS.slice(0, 7));
    seedSite(database);

    runMigrations(database);

    const publication = new PublicationRepository(database);
    const published = publication.listPublishedContent();
    expect(published).toHaveLength(6);
    expect(
      published.every((item) => item.currentPublishedRevisionId !== null)
    ).toBe(true);
    expect(
      database.query("SELECT COUNT(*) AS total FROM published_revisions").get()
    ).toEqual({ total: 6 });
    database.close();
  });

  test("apply on first run and record themselves", () => {
    const { database } = migratedDatabase();

    const applied = listAppliedMigrations(database);
    expect(applied.map((row) => row.id)).toEqual(
      MIGRATIONS.map((migration) => migration.id)
    );
    expect(applied.every((row) => row.applied_at.endsWith("Z"))).toBe(true);

    database.close();
  });

  test("are not re-applied on a second run", () => {
    const { database } = migratedDatabase();

    const outcome = runMigrations(database);

    expect(outcome.applied).toEqual([]);
    expect(outcome.alreadyApplied).toEqual(
      MIGRATIONS.map((migration) => migration.id)
    );

    database.close();
  });

  test("refuse a migration that changed after it was applied", () => {
    const { database } = migratedDatabase();

    const edited: Migration[] = MIGRATIONS.map((migration) =>
      migration.id === 1
        ? { ...migration, statements: [...migration.statements, "SELECT 1"] }
        : migration
    );

    expect(() => runMigrations(database, edited)).toThrow(/append-only/);

    database.close();
  });

  test("refuse a database carrying unknown migrations", () => {
    const { database } = migratedDatabase();

    // An older release meeting a newer database: running on would apply old
    // code to a schema it has never seen.
    expect(() => runMigrations(database, [])).toThrow(/does not know about/);

    database.close();
  });

  test("reject ids that repeat or move backwards", () => {
    const file = temporaryDatabaseFile();
    const database = openDatabase(file);
    const one: Migration = { id: 1, name: "a", statements: [] };

    expect(() => runMigrations(database, [one, { ...one, name: "b" }])).toThrow(
      /Duplicate migration id/
    );
    expect(() =>
      runMigrations(database, [
        { id: 2, name: "b", statements: [] },
        { id: 1, name: "a", statements: [] },
      ])
    ).toThrow(/must ascend/);

    database.close();
  });

  test("a failing migration leaves no partial schema behind", () => {
    const file = temporaryDatabaseFile();
    const database = openDatabase(file);

    const broken: Migration[] = [
      {
        id: 1,
        name: "half_broken",
        statements: [
          "CREATE TABLE first_half (id INTEGER PRIMARY KEY)",
          "THIS IS NOT SQL",
        ],
      },
    ];

    expect(() => runMigrations(database, broken)).toThrow(/failed/);

    const tables = database
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map((table) => table.name)).not.toContain("first_half");
    expect(listAppliedMigrations(database)).toEqual([]);

    database.close();
  });

  test("checksums track statement content", () => {
    const migration: Migration = { id: 1, name: "a", statements: ["SELECT 1"] };

    expect(checksumOf(migration)).toBe(checksumOf({ ...migration, name: "b" }));
    expect(checksumOf(migration)).not.toBe(
      checksumOf({ ...migration, statements: ["SELECT 2"] })
    );
  });
});

describe("system state", () => {
  test("starts in the legacy phase so nothing reads from SQLite yet", () => {
    const { database } = migratedDatabase();

    expect(new SystemStateRepository(database).getCutoverPhase()).toBe(
      "legacy"
    );

    database.close();
  });

  test("records a phase change", () => {
    const { database } = migratedDatabase();
    const repository = new SystemStateRepository(database);

    repository.setCutoverPhase("shadow");

    expect(repository.getCutoverPhase()).toBe("shadow");

    database.close();
  });

  test("rejects a phase the cutover state machine does not define", () => {
    const { database } = migratedDatabase();
    const repository = new SystemStateRepository(database);

    expect(() => repository.setCutoverPhase("whenever" as never)).toThrow(
      /Unknown cutover phase/
    );
    expect(repository.getCutoverPhase()).toBe("legacy");

    database.close();
  });

  test("the schema refuses an invalid phase even without the repository", () => {
    const { database } = migratedDatabase();

    expect(() =>
      database
        .query(
          "UPDATE system_state SET cutover_phase = 'nonsense' WHERE id = 1"
        )
        .run()
    ).toThrow();

    database.close();
  });

  test("only one system_state row can exist", () => {
    const { database } = migratedDatabase();

    expect(() =>
      database
        .query(
          "INSERT INTO system_state (id, cutover_phase, updated_at) VALUES (2, 'legacy', 'now')"
        )
        .run()
    ).toThrow();

    database.close();
  });
});

describe("health", () => {
  test("reports a migrated database as ok", () => {
    const { database, file } = migratedDatabase();

    const health = checkDatabaseHealth(database, file);

    expect(health.status).toBe("ok");
    expect(health.file).toBe(file);
    expect(health.journalMode?.toLowerCase()).toBe("wal");
    expect(health.synchronous).toBe(2);
    expect(health.foreignKeys).toBe(true);
    expect(health.appliedMigrations).toBe(MIGRATIONS.length);
    expect(health.cutoverPhase).toBe("legacy");
    expect(health.error).toBeUndefined();

    database.close();
  });

  test("reports an unmigrated database as an error rather than ok", () => {
    const file = temporaryDatabaseFile();
    const database = openDatabase(file);

    const health = checkDatabaseHealth(database, file);

    expect(health.status).toBe("error");
    expect(health.error).toBeTruthy();

    database.close();
  });

  test("reports a closed database as an error instead of throwing", () => {
    const { database, file } = migratedDatabase();
    database.close();

    expect(checkDatabaseHealth(database, file).status).toBe("error");
  });
});
