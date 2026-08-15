/**
 * The seam between the application and SQLite.
 *
 * Handlers talk to repositories, never to `bun:sqlite` directly. That keeps SQL
 * and engine-specific behaviour in one place, and gives the PostgreSQL move the
 * research anticipates a bounded surface to replace rather than a search across
 * every handler.
 *
 * Transaction boundaries are explicit. A Publication has to be one transaction —
 * insert the immutable revision, move the public pointer, commit — so callers
 * choose the boundary rather than inheriting a per-statement one by accident.
 */

import type { Database } from "bun:sqlite";

export type CutoverPhase =
  "legacy" | "shadow" | "sqlite-observation" | "sealed";

export const CUTOVER_PHASES: CutoverPhase[] = [
  "legacy",
  "shadow",
  "sqlite-observation",
  "sealed",
];

export abstract class Repository {
  constructor(protected readonly database: Database) {}

  /**
   * Runs `work` in one transaction, rolling back if it throws.
   *
   * Keep the body short and free of network or filesystem calls: SQLite allows
   * one writer at a time, and a slow transaction blocks every other write until
   * the busy timeout expires.
   */
  protected transaction<T>(work: () => T): T {
    return this.database.transaction(work)();
  }
}

export class SystemStateRepository extends Repository {
  getCutoverState(): { phase: CutoverPhase; updatedAt: string } {
    const row = this.database
      .query("SELECT cutover_phase, updated_at FROM system_state WHERE id = 1")
      .get() as { cutover_phase: CutoverPhase; updated_at: string } | null;

    if (!row) {
      throw new Error("system_state row is missing; migrations did not run");
    }

    return { phase: row.cutover_phase, updatedAt: row.updated_at };
  }

  /**
   * Which content source is authoritative right now. `legacy` means the public
   * site is still served entirely from repository content and nothing reads
   * from this database.
   */
  getCutoverPhase(): CutoverPhase {
    return this.getCutoverState().phase;
  }

  setCutoverPhase(phase: CutoverPhase): void {
    if (!CUTOVER_PHASES.includes(phase)) {
      throw new Error(`Unknown cutover phase "${phase}"`);
    }

    this.transaction(() => {
      this.database
        .query(
          `UPDATE system_state
             SET cutover_phase = ?,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = 1`
        )
        .run(phase);
    });
  }
}
