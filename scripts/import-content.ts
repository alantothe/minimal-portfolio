#!/usr/bin/env bun
/**
 * The import command.
 *
 * Dry run by default. Writing requires saying so, and writing to production
 * additionally requires the fingerprint of the source somebody reviewed — an
 * import is one-way, and the point of the fingerprint is that "I reviewed this"
 * and "this is what ran" are the same claim.
 *
 *   bun scripts/import-content.ts                       # plan and print
 *   bun scripts/import-content.ts --commit              # rehearsal, writes
 *   bun scripts/import-content.ts --commit --production --expect <sha>
 *
 * `--database` points at a disposable file for rehearsals. #42's acceptance is
 * two clean rehearsals producing identical reports, which is only meaningful
 * against a database that started empty both times.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/database/connection";
import { runMigrations } from "../src/server/database/migrator";
import { readLegacySources } from "../src/server/content/import/sources";
import { readLegacyConfig } from "../src/server/content/import/legacyConfig";
import { planImport } from "../src/server/content/import/plan";
import { runImport, serializeReport } from "../src/server/content/import/run";
import { stubMediaResolver } from "../src/server/content/import/stubResolver";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const commit = flag("commit");
  const production = flag("production");
  const expected = option("expect");

  const databasePath =
    option("database") ??
    join(mkdtempSync(join(tmpdir(), "import-rehearsal-")), "content.sqlite");

  const sources = readLegacySources();
  console.error(`[import] source fingerprint ${sources.fingerprint}`);
  console.error(`[import] database ${databasePath}`);

  const database = openDatabase(databasePath);
  runMigrations(database);

  // Credentials are not wired in yet, so the stub is the only resolver that
  // exists. It is deterministic, which is what keeps two rehearsals comparable.
  const plan = await planImport(
    sources,
    readLegacyConfig(),
    stubMediaResolver()
  );

  const report = runImport(database, plan, {
    mode: production ? "production" : "rehearsal",
    dryRun: !commit,
    expectedFingerprint: expected,
  });

  // The report goes to stdout so it can be redirected and diffed; everything
  // else goes to stderr.
  process.stdout.write(serializeReport(report));

  const blocking = report.findings.filter((f) => f.severity === "error");

  if (blocking.length > 0) {
    console.error(`[import] refused: ${blocking.length} blocking finding(s)`);
    for (const finding of blocking) {
      console.error(`  ${finding.field}: ${finding.code}`);
    }
    process.exit(1);
  }

  console.error(
    report.committed
      ? `[import] committed run ${report.runId}`
      : "[import] dry run; nothing written"
  );
}

main().catch((cause) => {
  console.error("[import] failed:", cause);
  process.exit(1);
});
