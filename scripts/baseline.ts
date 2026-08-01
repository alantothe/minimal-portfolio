#!/usr/bin/env bun
/**
 * Golden contract CLI.
 *
 *   bun run baseline:check     compare the current site against the baseline
 *   bun run baseline:capture   overwrite the baseline with the current site
 *
 * `check` is the one that runs in CI and during review. `capture` is deliberate:
 * re-capturing is how a public change gets accepted, so it should be an explicit
 * commit a reviewer can see, never a side effect of running the tests.
 */

import { format } from "prettier";
import {
  captureGoldenContract,
  serializeGoldenContract,
} from "../src/baseline/capture";
import {
  compareGoldenContracts,
  formatDifferences,
} from "../src/baseline/compare";
import {
  readGoldenContract,
  writeGoldenContractSource,
} from "../src/baseline/artifact";
import { BASELINE_ARTIFACT_PATH } from "../src/baseline/contract";

function summarize(label: string, count: number): string {
  return `  ${label.padEnd(9)} ${count}`;
}

async function capture(): Promise<void> {
  const contract = await captureGoldenContract();
  const source = await format(serializeGoldenContract(contract), {
    filepath: BASELINE_ARTIFACT_PATH,
  });
  await writeGoldenContractSource(source);

  console.log(`[baseline] wrote ${BASELINE_ARTIFACT_PATH}`);
  console.log(summarize("routes", contract.routes.length));
  console.log(summarize("content", contract.content.length));
  console.log(summarize("media", contract.media.length));
  console.log(summarize("views", contract.views.total));
}

async function check(): Promise<void> {
  const [expected, received] = await Promise.all([
    readGoldenContract(),
    captureGoldenContract(),
  ]);

  const differences = compareGoldenContracts(expected, received);
  if (differences.length === 0) {
    console.log(
      `[baseline] public behaviour matches ${BASELINE_ARTIFACT_PATH} (${received.routes.length} routes).`
    );
    return;
  }

  console.error(
    `[baseline] ${differences.length} difference(s) from ${BASELINE_ARTIFACT_PATH}:\n`
  );
  for (const line of formatDifferences(differences)) {
    console.error(`  ${line}\n`);
  }
  console.error(
    "[baseline] If every difference above is intended, re-capture with: bun run baseline:capture"
  );
  process.exitCode = 1;
}

const command = process.argv[2] ?? "check";

if (command === "capture") {
  await capture();
} else if (command === "check") {
  await check();
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: bun scripts/baseline.ts [check|capture]");
  process.exitCode = 1;
}
