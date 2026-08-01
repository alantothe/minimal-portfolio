/**
 * Pins every input that would otherwise make a capture vary between machines,
 * clocks, or deployments.
 *
 * The site reads three things that are not committed repository state:
 *
 * - `SITE_URL` decides the canonical origin, and differs local vs production.
 * - `GITHUB_TOKEN` / `GITHUB_USERNAME` turn on live GitHub metrics. Cleared,
 *   the GitHub services short-circuit to their configured fallbacks without
 *   touching the network, so the Home page renders deterministically.
 * - `BLOG_VIEWS_FILE` points at the Blog view store. Production writes to a
 *   mounted volume; the capture reads the committed file instead.
 *
 * The capture never sends `?view=1`, so no crawl can increment a Blog view.
 */

import { BASELINE_ORIGIN } from "./contract";

const PINNED_ENVIRONMENT: Record<string, string | undefined> = {
  SITE_URL: BASELINE_ORIGIN,
  GITHUB_TOKEN: undefined,
  GITHUB_USERNAME: undefined,
  BLOG_VIEWS_FILE: "./src/data/blog-views.json",
};

/**
 * Runs `operation` with the capture environment applied, restoring the previous
 * environment afterwards even if it throws.
 */
export async function withBaselineEnvironment<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(PINNED_ENVIRONMENT)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
