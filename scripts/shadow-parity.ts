#!/usr/bin/env bun
/**
 * The shadow parity run.
 *
 * Imports the legacy content into a disposable database, builds one published
 * generation from it, renders every route the golden contract covers, and diffs
 * the two. Nothing is served and nothing is written outside the temporary
 * database.
 *
 *   bun scripts/shadow-parity.ts               # live media if configured
 *   bun scripts/shadow-parity.ts --stub-media  # structure only, no provider
 *   bun scripts/shadow-parity.ts --json        # machine-readable report
 *
 * The run happens inside the *baseline environment* — the same pinned
 * `SITE_URL`, cleared GitHub credentials, and committed view store the golden
 * contract was captured under. Comparing a database render made under one
 * environment against a legacy capture made under another would measure the
 * environment, not the renderers.
 *
 * `--stub-media` cannot prove image parity. The stub resolver invents
 * deterministic ids without creating media rows, so every image resolves to
 * nothing and the run reports image differences it has no business explaining
 * away. That is deliberate: a parity gate that passed without checking images
 * would be worse than no gate.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/database/connection";
import { runMigrations } from "../src/server/database/migrator";
import { MediaRepository } from "../src/server/database/mediaRepository";
import { readLegacySources } from "../src/server/content/import/sources";
import { readLegacyConfig } from "../src/server/content/import/legacyConfig";
import { planImport } from "../src/server/content/import/plan";
import { runImport } from "../src/server/content/import/run";
import { stubMediaResolver } from "../src/server/content/import/stubResolver";
import { importMediaResolver } from "../src/server/content/import/mediaResolver";
import { CloudinaryProvider } from "../src/server/media/cloudinary";
import {
  resolveLegacyCloudName,
  resolveMediaConfig,
} from "../src/server/media/config";
import { buildSiteSnapshot } from "../src/server/published/snapshot";
import { PublishedSite } from "../src/server/published/site";
import { collectEnrichment } from "../src/server/published/enrichment";
import { shadowCrawl } from "../src/server/published/shadowCrawl";
import {
  compareContract,
  formatParityReport,
} from "../src/server/published/shadow";
import { readGoldenContract } from "../src/baseline/artifact";
import { BASELINE_ORIGIN } from "../src/baseline/contract";
import { withBaselineEnvironment } from "../src/baseline/environment";
import { stableJsonHash } from "../src/baseline/normalize";
import { RequestHandler } from "../src/server/core/requestHandler";
import { Router } from "../src/server/core/router";
import { setupRoutes } from "../src/server/routes";
import type { Database } from "bun:sqlite";
import type { GoldenContract } from "../src/baseline/contract";
import type { ImportMediaResolver } from "../src/server/content/import/plan";
import type { PayloadPair } from "../src/server/published/shadow";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function chooseResolver(database: Database): {
  resolver: ImportMediaResolver;
  live: boolean;
} {
  if (flag("stub-media")) {
    console.error("[shadow] media: stub (forced)");
    return { resolver: stubMediaResolver(), live: false };
  }

  const resolution = resolveMediaConfig();

  if (resolution.status !== "configured") {
    const detail =
      resolution.status === "invalid"
        ? resolution.reason
        : `missing ${resolution.missing.join(", ")}`;
    console.error(`[shadow] media: stub (${detail})`);
    return { resolver: stubMediaResolver(), live: false };
  }

  console.error(
    `[shadow] media: live, cloud "${resolution.config.cloudName}"` +
      ` (adopting legacy cloud "${resolveLegacyCloudName()}")`
  );

  return {
    resolver: importMediaResolver({
      config: resolution.config,
      repository: new MediaRepository(database),
      provider: new CloudinaryProvider(resolution.config),
      legacyCloudName: resolveLegacyCloudName(),
      onDiagnostic: ({ reference, kind, outcome }) => {
        console.error(`[shadow] media ${kind} ${outcome}: ${reference}`);
      },
    }),
    live: true,
  };
}

/**
 * Renders the legacy JSON for every API route, having first proved it has not
 * drifted from the golden contract.
 *
 * The contract records a hash for JSON routes and nothing else, so diffing a
 * published payload against it is impossible — the best it can say is "this
 * differs somewhere". Rendering legacy live gives something diffable, and
 * checking each live body against the recorded hash is what keeps the
 * comparison anchored to the frozen contract rather than to whatever legacy
 * happens to do today.
 */
async function legacyJsonPayloads(
  routes: GoldenContract["routes"],
  published: Map<string, string>
): Promise<Map<string, PayloadPair>> {
  const router = new Router();
  setupRoutes(router);
  const handler = new RequestHandler(router);

  const payloads = new Map<string, PayloadPair>();

  for (const route of routes) {
    if (route.kind !== "api") continue;

    const publishedBody = published.get(route.path);
    if (publishedBody === undefined) continue;

    const response = await handler.handleRequest(
      new Request(new URL(route.path, BASELINE_ORIGIN))
    );
    const body = await response.text();

    if (stableJsonHash(body) !== route.bodyHash) {
      // Legacy no longer matches what slice 1 froze. Comparing against it would
      // launder that drift into the parity result.
      throw new Error(
        `legacy ${route.path} no longer matches the golden contract; run bun run baseline:check`
      );
    }

    payloads.set(route.path, { baseline: body, published: publishedBody });
  }

  return payloads;
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "shadow-parity-"));
  const databasePath = join(directory, "content.sqlite");

  try {
    const database = openDatabase(databasePath);
    runMigrations(database);

    const { resolver, live } = chooseResolver(database);
    const sources = readLegacySources();
    console.error(`[shadow] source fingerprint ${sources.fingerprint}`);

    const plan = await planImport(sources, readLegacyConfig(), resolver);
    const report = runImport(database, plan, {
      mode: "rehearsal",
      dryRun: false,
    });

    if (!report.committed) {
      console.error("[shadow] import refused; parity cannot run");
      for (const finding of report.findings.filter(
        (f) => f.severity === "error"
      )) {
        console.error(`  ${finding.field}: ${finding.code}`);
      }
      process.exit(1);
    }

    // The whole comparison runs pinned, including the import's own view of the
    // environment, so `SITE_URL` is the sentinel the contract recorded.
    const parity = await withBaselineEnvironment(async () => {
      const site = new PublishedSite(() => buildSiteSnapshot(database));
      const outcome = site.refresh();

      if (outcome.status === "rejected") {
        console.error("[shadow] no generation could be built:");
        for (const finding of outcome.findings) {
          console.error(`  ${finding.field}: ${finding.code}`);
        }
        process.exit(1);
      }

      const snapshot = site.snapshot()!;
      const enrichment = await collectEnrichment(snapshot);
      const contract = await readGoldenContract();

      const crawl = await shadowCrawl(
        contract.routes.map((route) => ({
          path: route.path,
          kind: route.kind,
        })),
        site,
        BASELINE_ORIGIN,
        enrichment
      );

      for (const excluded of crawl.excluded) {
        console.error(`[shadow] not compared: ${excluded.path}`);
        console.error(`           ${excluded.reason}`);
      }

      return compareContract(
        snapshot.generation,
        contract.routes,
        crawl.snapshots,
        new Map(crawl.excluded.map((entry) => [entry.path, entry.reason])),
        await legacyJsonPayloads(contract.routes, crawl.bodies)
      );
    });

    if (flag("json")) {
      process.stdout.write(`${JSON.stringify(parity, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatParityReport(parity)}\n`);
    }

    if (!live) {
      console.error(
        "[shadow] media was stubbed: image parity is NOT proven by this run"
      );
    }

    console.error(
      parity.passed
        ? "[shadow] parity holds: every difference is zero or allowlisted"
        : "[shadow] parity FAILED: unexplained differences above"
    );

    process.exit(parity.passed ? 0 : 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((cause) => {
  console.error("[shadow] failed:", cause);
  process.exit(1);
});
