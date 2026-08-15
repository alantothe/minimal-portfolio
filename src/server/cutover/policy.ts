/**
 * What each cutover phase means for Visitors, views, and Owner publication.
 *
 * The persisted phase lives in `system_state`. This module is the only place
 * that interprets it. A caller that asks `phase === "sealed"` is duplicating
 * policy and will drift the first time a fifth phase appears.
 *
 * Spec: #36 section 5, issue #47.
 */

import type { Database } from "bun:sqlite";
import {
  SystemStateRepository,
  type CutoverPhase,
} from "../database/repository";

export type ContentSource = "legacy" | "published";
export type ViewsSource = "json" | "sqlite";

export interface CutoverPolicy {
  /** Where public HTML/JSON/SEO/sitemap are read from. */
  contentSource: ContentSource;
  /** Where Blog view counts are read and written. */
  viewsSource: ViewsSource;
  /** Whether Owner Publication is allowed. */
  publicationEnabled: boolean;
  /**
   * Whether repository content may still be used as a runtime fallback.
   * False once sealed: recovery is backup/revision, never files.
   */
  legacyFallbackAllowed: boolean;
  /** Whether a missing published generation must fail `/readyz`. */
  gatesReadiness: boolean;
}

export function cutoverPolicy(phase: CutoverPhase): CutoverPolicy {
  switch (phase) {
    case "legacy":
    case "shadow":
      return {
        contentSource: "legacy",
        viewsSource: "json",
        publicationEnabled: false,
        legacyFallbackAllowed: true,
        gatesReadiness: false,
      };
    case "sqlite-observation":
      return {
        contentSource: "published",
        viewsSource: "json",
        publicationEnabled: false,
        legacyFallbackAllowed: true,
        gatesReadiness: true,
      };
    case "sealed":
      return {
        contentSource: "published",
        viewsSource: "sqlite",
        publicationEnabled: true,
        legacyFallbackAllowed: false,
        gatesReadiness: true,
      };
  }
}

export interface RuntimeCutoverConfig {
  /**
   * Operator override that would keep public reads on repository files.
   * Allowed before seal so a rollback can force the candidate off; forbidden
   * afterwards because a sealed process has no legacy fallback.
   */
  forceLegacyContent: boolean;
}

/**
 * #47: a sealed process must refuse any configuration that tries to serve
 * legacy content. Call at startup; throwing is the only safe answer because
 * a process that continued would be lying about which source is authoritative.
 */
export function refuseLegacyContentWhenSealed(
  phase: CutoverPhase,
  config: RuntimeCutoverConfig
): void {
  if (phase === "sealed" && config.forceLegacyContent) {
    throw new Error("A sealed process cannot serve legacy content");
  }
}

export type TransitionKind = "advance" | "rollback";

export type TransitionPlan =
  | { status: "allowed"; kind: TransitionKind }
  | {
      status: "refused";
      reason: "not_adjacent" | "same_phase" | "sealed" | "seal_incomplete";
    };

export interface SealChecks {
  parity: boolean;
  views: boolean;
  backup: boolean;
  restore: boolean;
  auth: boolean;
  media: boolean;
  observationElapsed: boolean;
}

const FORWARD: Record<CutoverPhase, CutoverPhase | null> = {
  legacy: "shadow",
  shadow: "sqlite-observation",
  "sqlite-observation": "sealed",
  sealed: null,
};

function sealReady(checks: SealChecks | undefined): boolean {
  return Boolean(
    checks?.parity &&
    checks.views &&
    checks.backup &&
    checks.restore &&
    checks.auth &&
    checks.media &&
    checks.observationElapsed
  );
}

/**
 * The only legal moves. Forward one step; rollback to `legacy` while the
 * seal has not happened. After `sealed`, the machine does not move.
 */
export function planTransition(
  from: CutoverPhase,
  to: CutoverPhase,
  checks?: SealChecks
): TransitionPlan {
  if (from === "sealed") {
    return { status: "refused", reason: "sealed" };
  }

  if (FORWARD[from] === to) {
    if (to === "sealed" && !sealReady(checks)) {
      return { status: "refused", reason: "seal_incomplete" };
    }
    return { status: "allowed", kind: "advance" };
  }

  if (to === "legacy" && (from === "shadow" || from === "sqlite-observation")) {
    return { status: "allowed", kind: "rollback" };
  }

  return { status: "refused", reason: "not_adjacent" };
}

export function applyPhaseChange(
  database: Database,
  to: CutoverPhase,
  checks?: SealChecks
): TransitionPlan {
  const repository = new SystemStateRepository(database);
  const plan = planTransition(repository.getCutoverPhase(), to, checks);
  if (plan.status === "allowed") {
    repository.setCutoverPhase(to);
  }
  return plan;
}
