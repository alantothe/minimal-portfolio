#!/usr/bin/env bun

/**
 * Operator commands for the cutover state machine.
 *
 * Production stays `legacy` until one of these commands advances it. Merging
 * Slice 10 therefore does not change what Visitors see.
 */

import { openDatabase } from "../src/server/database/connection";
import { resolveDatabaseFile } from "../src/server/database/config";
import { checkDatabaseHealth } from "../src/server/database/health";
import {
  CUTOVER_PHASES,
  SystemStateRepository,
  type CutoverPhase,
} from "../src/server/database/repository";
import {
  applyPhaseChange,
  cutoverPolicy,
  type SealChecks,
} from "../src/server/cutover/policy";
import {
  applyFinalViewCounts,
  reportViewReconciliation,
} from "../src/server/cutover/views";
import { JsonViewStore } from "../src/server/services/views";

function usage(): never {
  console.error(`Usage:
  bun scripts/cutover.ts status
  bun scripts/cutover.ts advance shadow|sqlite-observation|sealed [--confirm-checks]
  bun scripts/cutover.ts rollback legacy
  bun scripts/cutover.ts reconcile-views [--commit]

  Sealing requires --confirm-checks. That flag is the operator attesting that
  parity, view totals, backup, restore, auth, media, and 24h observation are
  complete. The machine will not seal without it.
`);
  process.exit(2);
}

function isPhase(value: string | undefined): value is CutoverPhase {
  return CUTOVER_PHASES.includes(value as CutoverPhase);
}

function openContentDatabase() {
  const file = resolveDatabaseFile();
  const database = openDatabase(file);
  const health = checkDatabaseHealth(database, file);
  if (health.status !== "ok") {
    database.close();
    throw new Error(health.error ?? "Content database is not healthy");
  }
  return { database, health };
}

function attestedChecks(args: string[]): SealChecks | undefined {
  if (!args.includes("--confirm-checks")) return undefined;
  return {
    parity: true,
    views: true,
    backup: true,
    restore: true,
    auth: true,
    media: true,
    observationElapsed: true,
  };
}

async function status(): Promise<void> {
  const { database, health } = openContentDatabase();
  const state = new SystemStateRepository(database).getCutoverState();
  console.log(
    JSON.stringify(
      {
        phase: state.phase,
        updatedAt: state.updatedAt,
        file: health.file,
        policy: cutoverPolicy(state.phase),
      },
      null,
      2
    )
  );
  database.close();
}

function advance(args: string[]): void {
  const to = args[0];
  if (!isPhase(to) || to === "legacy") usage();
  const { database } = openContentDatabase();
  const from = new SystemStateRepository(database).getCutoverPhase();
  const plan = applyPhaseChange(database, to, attestedChecks(args));
  if (plan.status === "refused") {
    database.close();
    console.error(JSON.stringify({ from, to, ...plan }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ from, to, ...plan }, null, 2));
  database.close();
}

function rollback(args: string[]): void {
  const to = args[0];
  if (to !== "legacy") usage();
  const { database } = openContentDatabase();
  const from = new SystemStateRepository(database).getCutoverPhase();
  const plan = applyPhaseChange(database, "legacy");
  if (plan.status === "refused") {
    database.close();
    console.error(JSON.stringify({ from, to: "legacy", ...plan }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ from, to: "legacy", ...plan }, null, 2));
  database.close();
}

async function reconcileViews(args: string[]): Promise<void> {
  const { database } = openContentDatabase();
  const jsonCounts = await new JsonViewStore().getAll();
  const before = reportViewReconciliation(database, jsonCounts);
  if (!args.includes("--commit")) {
    console.log(JSON.stringify({ committed: false, ...before }, null, 2));
    database.close();
    if (before.status !== "matched") process.exit(1);
    return;
  }
  applyFinalViewCounts(database, jsonCounts);
  const after = reportViewReconciliation(database, jsonCounts);
  console.log(JSON.stringify({ committed: true, ...after }, null, 2));
  database.close();
  if (after.status !== "matched") process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "status":
    await status();
    break;
  case "advance":
    advance(args);
    break;
  case "rollback":
    rollback(args);
    break;
  case "reconcile-views":
    await reconcileViews(args);
    break;
  default:
    usage();
}
