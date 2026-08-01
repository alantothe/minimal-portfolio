/**
 * Gathering the optional facts a page shows beside its content.
 *
 * #34's rule for all of this is one sentence: optional data must never take core
 * published pages down. So every source is fetched independently, every failure
 * is contained to its own field, and a field that could not be gathered comes
 * back as `null`.
 *
 * `null` is not `0`. A GitHub outage means "we do not know how many commits
 * there were", and rendering that as zero commits would be publishing a false
 * statement about somebody's month. The Home template shows nothing at all for a
 * null, which is the existing neutral state rather than a new one.
 *
 * Blog view counts come from here rather than from the read path for the other
 * half of that decision: #34 moves view *recording* into an explicit POST so
 * that content GETs stay pure and safe to revalidate. A count is a fact about a
 * page, not part of it.
 */

import { renderGitHubActivityPanel } from "../services/githubActivity";
import {
  getMonthlyCommitCount,
  getYearlyContributionActivity,
} from "../services/github";
import { getTotalViews, getViewCounts } from "../services/views";
import type { SiteEnrichment } from "./render";
import { NO_ENRICHMENT } from "./render";
import type { SiteSnapshot } from "./snapshot";

/**
 * Runs one optional lookup, swallowing its failure.
 *
 * Returns the fallback rather than rethrowing, and reports what happened through
 * `onFailure` so an operator still learns that GitHub is down. Silence would
 * make a permanently degraded page indistinguishable from a working one.
 */
async function optional<T>(
  name: string,
  fallback: T,
  work: () => Promise<T>,
  onFailure: (name: string, cause: unknown) => void
): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    onFailure(name, cause);
    return fallback;
  }
}

export interface EnrichmentOptions {
  onFailure?: (name: string, cause: unknown) => void;
}

/**
 * Everything optional, gathered concurrently.
 *
 * Concurrent because these are independent network and disk reads and one slow
 * one should not serialise the rest; `Promise.all` is safe here precisely
 * because each lookup already contains its own failure.
 */
export async function collectEnrichment(
  snapshot: SiteSnapshot,
  options: EnrichmentOptions = {}
): Promise<SiteEnrichment> {
  const onFailure =
    options.onFailure ??
    ((name, cause) => {
      console.error(`[published] enrichment ${name} unavailable:`, cause);
    });

  // The environment still wins over content, matching the legacy handler: an
  // operator who set GITHUB_USERNAME is overriding the account being reported
  // on, and that override is deployment configuration rather than content.
  const githubUsername =
    process.env.GITHUB_USERNAME || snapshot.home.githubUsername;

  const [commits, activity, viewsBySlug, totalViews] = await Promise.all([
    optional<number | null>(
      "github-commits",
      null,
      async () => {
        const count = await getMonthlyCommitCount();
        // The service reports 0 both for "no commits" and for "could not ask".
        // Only a positive count is a fact worth printing.
        return count > 0 ? count : null;
      },
      onFailure
    ),
    optional<Awaited<ReturnType<typeof getYearlyContributionActivity>> | null>(
      "github-activity",
      null,
      () => getYearlyContributionActivity(),
      onFailure
    ),
    optional<Record<string, number>>(
      "blog-views",
      {},
      () => getViewCounts(),
      onFailure
    ),
    optional<number | null>(
      "blog-views-total",
      null,
      () => getTotalViews(),
      onFailure
    ),
  ]);

  return {
    ...NO_ENRICHMENT,
    githubCommits: commits,
    // The panel renders its own "Yearly activity unavailable" state from a null
    // activity, so the neutral case stays owned by the component that draws it.
    githubActivityPanel: renderGitHubActivityPanel(activity, githubUsername),
    blogPostCount: snapshot.blogPosts.length,
    totalViews,
    viewsBySlug,
  };
}
