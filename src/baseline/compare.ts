/**
 * Explains how a fresh capture differs from the committed contract.
 *
 * A boolean "changed" is useless during a migration — the whole point is to see
 * exactly which route, which field, and which value moved, so a reviewer can
 * decide whether it is an allowlisted rendering difference or a real public
 * regression.
 */

import type { GoldenContract } from "./contract";

export interface ContractDifference {
  path: string;
  expected: unknown;
  received: unknown;
}

const MAX_RENDERED_VALUE = 120;

export function compareGoldenContracts(
  expected: GoldenContract,
  received: GoldenContract
): ContractDifference[] {
  const differences: ContractDifference[] = [];
  collectDifferences("", expected, received, differences);
  return differences;
}

function collectDifferences(
  path: string,
  expected: unknown,
  received: unknown,
  differences: ContractDifference[]
): void {
  if (Object.is(expected, received)) {
    return;
  }

  if (!isRecordOrArray(expected) || !isRecordOrArray(received)) {
    differences.push({ path: path || "<root>", expected, received });
    return;
  }

  if (Array.isArray(expected) !== Array.isArray(received)) {
    differences.push({ path: path || "<root>", expected, received });
    return;
  }

  if (Array.isArray(expected) && Array.isArray(received)) {
    const length = Math.max(expected.length, received.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferences(
        `${path}[${index}]`,
        expected[index],
        received[index],
        differences
      );
    }
    return;
  }

  const expectedRecord = expected as Record<string, unknown>;
  const receivedRecord = received as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(expectedRecord),
    ...Object.keys(receivedRecord),
  ]);

  for (const key of [...keys].sort()) {
    collectDifferences(
      path ? `${path}.${key}` : key,
      expectedRecord[key],
      receivedRecord[key],
      differences
    );
  }
}

function isRecordOrArray(
  value: unknown
): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function render(value: unknown): string {
  if (value === undefined) return "<missing>";
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return String(value);
  return serialized.length > MAX_RENDERED_VALUE
    ? `${serialized.slice(0, MAX_RENDERED_VALUE)}…`
    : serialized;
}

export function formatDifferences(differences: ContractDifference[]): string[] {
  return differences.map(
    (difference) =>
      `${difference.path}\n    baseline: ${render(difference.expected)}\n    current:  ${render(difference.received)}`
  );
}
