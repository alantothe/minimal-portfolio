/**
 * Readiness probe.
 *
 * `/healthz` answers "is this process alive" and stays a pure liveness check.
 * `/readyz` answers the harder question — "can this deployment do its job" —
 * which now includes reaching the content database on the persistent volume.
 *
 * Railway health-checks this route, so a deployment whose volume is missing or
 * whose migrations failed never replaces the one currently serving Visitors.
 *
 * The published generation is *reported* here but does not gate readiness while
 * the cutover phase is `legacy` or `shadow`. During those phases no Visitor
 * reads it, and failing a deploy of a site that is serving correctly from
 * repository content because a dark subsystem had a bad day would be the probe
 * causing the outage it exists to prevent. From `sqlite-observation` onward the
 * generation *is* the site, and the gate closes.
 */

import { databaseHealth } from "../database";
import {
  getPublishedSite,
  publishedSiteGatesReadiness,
} from "../published/lifecycle";
import { recoveryRuntimeStatus } from "../recovery/runtime";

export async function readinessHandler(): Promise<Response> {
  const database = databaseHealth();
  const site = getPublishedSite();
  const published = site?.state() ?? null;
  const recovery = recoveryRuntimeStatus();

  const phase = database.cutoverPhase;
  const gates = phase !== undefined && publishedSiteGatesReadiness(phase);

  const ready =
    database.status === "ok" &&
    (!gates ||
      published?.status === "ready" ||
      published?.status === "degraded");

  return new Response(
    JSON.stringify({
      status: ready ? "ready" : "unready",
      database,
      recovery,
      published: published
        ? {
            status: published.status,
            generation: published.generation,
            builtAt: published.builtAt,
            activations: published.activations,
            rejections: published.rejections,
            // The codes only. A finding's field can name a content id and
            // `detail` carries raw driver error text, and a readiness probe is
            // a public endpoint. `Finding.code` is a stable token by
            // construction — see `SiteFailure` — so codes are safe to publish.
            lastFailure: published.lastFailure
              ? {
                  at: published.lastFailure.at,
                  codes: published.lastFailure.findings.map(
                    (finding) => finding.code
                  ),
                }
              : null,
            gatesReadiness: gates,
          }
        : null,
    }),
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
