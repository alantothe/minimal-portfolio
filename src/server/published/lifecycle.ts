/**
 * The published site's place in the running process.
 *
 * One `PublishedSite` per process, warmed at startup so the first Visitor after
 * a deploy is served from a validated generation rather than waiting for one to
 * be built. That warm generation is also what survives SQLite becoming
 * unreachable later, which is the whole point of holding it in memory.
 *
 * **Nothing here is reachable from a route.** The site is built, validated, and
 * reported on; it is not served. Until the cutover slice moves public reads onto
 * it, its only consumers are the readiness probe and the shadow parity run.
 *
 * Startup deliberately does not throw, for the same reason `database/index.ts`
 * does not: during `legacy` the public site is served entirely from repository
 * content, so a generation that cannot be built must not take down a site that
 * is working perfectly. It is reported, loudly, and readiness decides what to do
 * with that based on the cutover phase.
 */

import { getDatabase, isDatabaseAvailable } from "../database";
import type { CutoverPhase } from "../database/repository";
import { buildSiteSnapshot } from "./snapshot";
import { PublishedSite, type PublishedSiteState } from "./site";

let site: PublishedSite | null = null;

/**
 * Builds the process's published site and warms its first generation.
 *
 * Safe to call again; a second call replaces the instance, which is what a test
 * or a future reload path needs.
 */
export function initializePublishedSite(): PublishedSiteState {
  site = new PublishedSite(() => {
    // Reached through `getDatabase` on every refresh rather than captured once,
    // so a database that was reopened after a failure is picked up instead of
    // this holding a handle to a closed one forever.
    if (!isDatabaseAvailable()) {
      throw new Error("Content database is unavailable");
    }

    return buildSiteSnapshot(getDatabase());
  });

  const outcome = site.refresh();

  if (outcome.status === "rejected") {
    console.error(
      `[published] no generation could be built (${outcome.findings.length} finding(s)):`
    );
    for (const finding of outcome.findings.slice(0, 10)) {
      console.error(`  ${finding.field}: ${finding.code}`);
    }
    // The operator's copy of the underlying error. Deliberately logged here and
    // nowhere else: the readiness probe is public and must not carry it.
    const detail = site.state().lastFailure?.detail;
    if (detail) console.error(`  detail: ${detail}`);
  } else {
    console.log(
      `[published] generation ${outcome.generation} ${outcome.status}`
    );
  }

  return site.state();
}

/**
 * The process's published site.
 *
 * Null before initialization rather than lazily constructed: a caller that got
 * an instance built outside startup would be reading a generation nobody logged
 * and nobody validated at a known point in time.
 */
export function getPublishedSite(): PublishedSite | null {
  return site;
}

export function closePublishedSite(): void {
  site = null;
}

/**
 * Whether a failed generation should fail the deployment.
 *
 * While the phase is `legacy`, no Visitor reads this generation, so a content
 * problem must not roll back a deploy of a site that is serving correctly from
 * repository content. From `sqlite-observation` onward the generation *is* the
 * site, and a process without one has nothing truthful to serve — at that point
 * readiness has to fail so the previous deployment keeps serving.
 *
 * `shadow` sits on the legacy side of that line deliberately: shadow mode exists
 * to observe a generation being built, and a build failure is information rather
 * than an outage.
 */
export function publishedSiteGatesReadiness(phase: CutoverPhase): boolean {
  return phase === "sqlite-observation" || phase === "sealed";
}
