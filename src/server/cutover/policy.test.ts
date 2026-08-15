/**
 * The cutover state machine as a total function over phases.
 *
 * #36 is the spec: each phase has one content source, one views source, and
 * one answer for Owner publication. Callers must not re-derive those from
 * ad-hoc `=== "sealed"` checks.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { SystemStateRepository } from "../database/repository";
import { CUTOVER_PHASES } from "../database/repository";
import { migratedDatabase } from "../published/fixtures";
import {
  applyPhaseChange,
  cutoverPolicy,
  planTransition,
  refuseLegacyContentWhenSealed,
} from "./policy";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("cutover policy", () => {
  test("legacy and shadow keep Visitors on repository content and JSON views", () => {
    for (const phase of ["legacy", "shadow"] as const) {
      expect(cutoverPolicy(phase)).toEqual({
        contentSource: "legacy",
        viewsSource: "json",
        publicationEnabled: false,
        legacyFallbackAllowed: true,
        gatesReadiness: false,
      });
    }
  });

  test("sqlite-observation serves the published generation while views stay on JSON", () => {
    expect(cutoverPolicy("sqlite-observation")).toEqual({
      contentSource: "published",
      viewsSource: "json",
      publicationEnabled: false,
      legacyFallbackAllowed: true,
      gatesReadiness: true,
    });
  });

  test("sealed serves published content and SQLite views and enables publication", () => {
    expect(cutoverPolicy("sealed")).toEqual({
      contentSource: "published",
      viewsSource: "sqlite",
      publicationEnabled: true,
      legacyFallbackAllowed: false,
      gatesReadiness: true,
    });
  });

  test("every persisted phase has a complete policy", () => {
    for (const phase of CUTOVER_PHASES) {
      const policy = cutoverPolicy(phase);
      expect(
        policy.contentSource === "legacy" ||
          policy.contentSource === "published"
      ).toBe(true);
      expect(
        policy.viewsSource === "json" || policy.viewsSource === "sqlite"
      ).toBe(true);
    }
  });

  test("a sealed process refuses a configuration that would serve legacy content", () => {
    expect(() =>
      refuseLegacyContentWhenSealed("sealed", { forceLegacyContent: true })
    ).toThrow(/cannot serve legacy content/);

    expect(() =>
      refuseLegacyContentWhenSealed("sealed", { forceLegacyContent: false })
    ).not.toThrow();

    expect(() =>
      refuseLegacyContentWhenSealed("sqlite-observation", {
        forceLegacyContent: true,
      })
    ).not.toThrow();
  });
});

describe("cutover transitions", () => {
  test("advances only to the next adjacent phase", () => {
    expect(planTransition("legacy", "shadow")).toEqual({
      status: "allowed",
      kind: "advance",
    });
    expect(planTransition("shadow", "sqlite-observation")).toEqual({
      status: "allowed",
      kind: "advance",
    });
    expect(planTransition("legacy", "sqlite-observation")).toEqual({
      status: "refused",
      reason: "not_adjacent",
    });
    expect(planTransition("legacy", "sealed")).toEqual({
      status: "refused",
      reason: "not_adjacent",
    });
  });

  test("rolls back to legacy until the system is sealed", () => {
    expect(planTransition("shadow", "legacy")).toEqual({
      status: "allowed",
      kind: "rollback",
    });
    expect(planTransition("sqlite-observation", "legacy")).toEqual({
      status: "allowed",
      kind: "rollback",
    });
    expect(planTransition("sealed", "legacy")).toEqual({
      status: "refused",
      reason: "sealed",
    });
    expect(planTransition("sealed", "shadow")).toEqual({
      status: "refused",
      reason: "sealed",
    });
  });

  test("the final seal is blocked until every required check is complete", () => {
    const incomplete = {
      parity: true,
      views: true,
      backup: true,
      restore: true,
      auth: true,
      media: true,
      observationElapsed: false,
    };

    expect(planTransition("sqlite-observation", "sealed", incomplete)).toEqual({
      status: "refused",
      reason: "seal_incomplete",
    });

    expect(
      planTransition("sqlite-observation", "sealed", {
        ...incomplete,
        observationElapsed: true,
      })
    ).toEqual({
      status: "allowed",
      kind: "advance",
    });
  });
});

describe("persisted phase changes", () => {
  test("refuses to skip a gate even when the repository would store it", () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);

    expect(applyPhaseChange(database, "sqlite-observation")).toEqual({
      status: "refused",
      reason: "not_adjacent",
    });
    expect(new SystemStateRepository(database).getCutoverPhase()).toBe(
      "legacy"
    );

    expect(applyPhaseChange(database, "shadow")).toEqual({
      status: "allowed",
      kind: "advance",
    });
    expect(new SystemStateRepository(database).getCutoverPhase()).toBe(
      "shadow"
    );
    database.close();
  });
});
