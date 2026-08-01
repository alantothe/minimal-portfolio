/**
 * Readiness probe.
 *
 * `/healthz` answers "is this process alive" and stays a pure liveness check.
 * `/readyz` answers the harder question — "can this deployment do its job" —
 * which now includes reaching the content database on the persistent volume.
 *
 * Railway health-checks this route, so a deployment whose volume is missing or
 * whose migrations failed never replaces the one currently serving Visitors.
 */

import { databaseHealth } from "../database";

export async function readinessHandler(): Promise<Response> {
  const database = databaseHealth();
  const ready = database.status === "ok";

  return new Response(
    JSON.stringify({ status: ready ? "ready" : "unready", database }),
    {
      status: ready ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        // Never cached: a stale readiness answer is worse than none.
        "Cache-Control": "no-store",
      },
    }
  );
}
