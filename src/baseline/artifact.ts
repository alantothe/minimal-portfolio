/**
 * Reading and writing the committed golden-contract artifact.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BASELINE_ARTIFACT_PATH,
  BASELINE_VERSION,
  type GoldenContract,
} from "./contract";
import { serializeGoldenContract } from "./capture";

export async function readGoldenContract(
  path: string = BASELINE_ARTIFACT_PATH
): Promise<GoldenContract> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `No baseline at ${path}. Capture one with: bun run baseline:capture`
    );
  }

  const contract = JSON.parse(raw) as GoldenContract;
  if (contract.version !== BASELINE_VERSION) {
    throw new Error(
      `Baseline at ${path} is version ${contract.version}, but this code writes version ${BASELINE_VERSION}. Re-capture it.`
    );
  }

  return contract;
}

/**
 * Writes an already-serialized contract.
 *
 * Serialization is the caller's job so the CLI can hand the artifact to
 * Prettier first. The repository formats every committed file, and an
 * unformatted capture would be reformatted by the pre-commit hook — making each
 * `baseline:capture` produce cosmetic churn on top of the real diff.
 */
export async function writeGoldenContractSource(
  source: string,
  path: string = BASELINE_ARTIFACT_PATH
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, "utf8");
}

export async function writeGoldenContract(
  contract: GoldenContract,
  path: string = BASELINE_ARTIFACT_PATH
): Promise<void> {
  await writeGoldenContractSource(serializeGoldenContract(contract), path);
}
