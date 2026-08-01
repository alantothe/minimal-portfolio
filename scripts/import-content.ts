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
 *   bun scripts/import-content.ts --stub-media          # plan without touching
 *                                                       # the provider
 *
 * `--database` points at a disposable file for rehearsals. #42's acceptance is
 * two clean rehearsals producing identical reports, which is only meaningful
 * against a database that started empty both times.
 *
 * Media resolution follows the environment rather than a flag: configured
 * credentials mean real uploads, and no credentials means the deterministic
 * stub. `--stub-media` forces the stub even when credentials exist, which is
 * how the planning logic gets exercised without spending provider calls.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/database/connection";
import { runMigrations } from "../src/server/database/migrator";
import { MediaRepository } from "../src/server/database/mediaRepository";
import { readLegacySources } from "../src/server/content/import/sources";
import { readLegacyConfig } from "../src/server/content/import/legacyConfig";
import { planImport } from "../src/server/content/import/plan";
import { runImport, serializeReport } from "../src/server/content/import/run";
import { stubMediaResolver } from "../src/server/content/import/stubResolver";
import { importMediaResolver } from "../src/server/content/import/mediaResolver";
import { CloudinaryProvider } from "../src/server/media/cloudinary";
import {
  resolveLegacyCloudName,
  resolveMediaConfig,
} from "../src/server/media/config";
import type { Database } from "bun:sqlite";
import type { ImportMediaResolver } from "../src/server/content/import/plan";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Chooses how images get resolved, and says so.
 *
 * Announced on stderr in every case. Which resolver ran is the difference
 * between a report whose media ids name real assets and one whose ids name
 * nothing at all, and that is not a thing anyone should have to infer from the
 * absence of an error.
 */
function chooseResolver(database: Database): ImportMediaResolver {
  if (flag("stub-media")) {
    console.error("[import] media: stub (forced by --stub-media)");
    return stubMediaResolver();
  }

  const resolution = resolveMediaConfig();

  if (resolution.status !== "configured") {
    const detail =
      resolution.status === "invalid"
        ? resolution.reason
        : `missing ${resolution.missing.join(", ")}`;

    console.error(`[import] media: stub (${detail})`);
    console.error(
      "[import] media ids in this report name nothing; this is a rehearsal only"
    );
    return stubMediaResolver();
  }

  const legacyCloudName = resolveLegacyCloudName();

  console.error(
    `[import] media: live, uploading to cloud "${resolution.config.cloudName}"`
  );
  console.error(`[import] media: adopting legacy cloud "${legacyCloudName}"`);

  return importMediaResolver({
    config: resolution.config,
    repository: new MediaRepository(database),
    provider: new CloudinaryProvider(resolution.config),
    legacyCloudName,
    // Every reference the resolver could not adopt, with the reason. The
    // planner turns each one into a `media_unresolved` finding, which says
    // *that* it failed but never why.
    onDiagnostic: ({ reference, kind, outcome }) => {
      console.error(`[import] media ${kind} ${outcome}: ${reference}`);
    },
  });
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

  const resolver = chooseResolver(database);

  // Media is resolved during *planning*, because the plan has to report the ids
  // the content will point at. So `--commit` governs content rows and not
  // images: a dry run against a live provider really does upload.
  //
  // That is safe rather than sloppy, and only because ids are derived from the
  // content hash — the upload is idempotent, a second run adopts what the first
  // one stored, and no duplicate is ever created. It is still a side effect
  // outside this machine, so it gets said out loud.
  if (!commit && !flag("stub-media")) {
    console.error(
      "[import] note: media is resolved while planning, so images may be uploaded even on a dry run"
    );
  }

  const plan = await planImport(sources, readLegacyConfig(), resolver);

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
