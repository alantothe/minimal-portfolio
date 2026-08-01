/**
 * The module every public content read goes through.
 *
 * #34's central instruction is that SSR, JSON, SEO, redirects, and sitemap stop
 * reading the filesystem independently and start asking one question of one
 * object. This class is that object. Its whole surface is three methods —
 * `resolve`, `discovery`, `state` — and the reason it is so small is that a
 * caller with more options is a caller that can produce a page describing a
 * different generation than its own SEO tags.
 *
 * The active snapshot is replaced whole or not at all. There is no method to
 * update one page, because #34 requires generation activation to be whole-site
 * atomic: a refresh that fails leaves the previous generation serving untouched,
 * which is what lets a warm process survive SQLite going away entirely.
 */

import type { Finding } from "../content/validation";
import type { SiteSnapshot, SnapshotBuild } from "./snapshot";
import {
  canonicalRouteFor,
  fixedRedirectFor,
  ownsPath,
  parseTarget,
  type PublishedTarget,
  type PublishedView,
  type Resolution,
} from "./target";

/**
 * `ready` means the active generation is current. `degraded` means a complete,
 * previously validated generation is still being served but a refresh has since
 * failed — the site is correct but no longer known to be up to date.
 * `unavailable` means no validated generation exists at all.
 */
export type SiteStatus = "ready" | "degraded" | "unavailable";

export interface SiteFailure {
  at: string;
  findings: Finding[];
}

export interface PublishedSiteState {
  status: SiteStatus;
  generation: string | null;
  builtAt: string | null;
  /** Refreshes that produced a new active generation. */
  activations: number;
  /** Refreshes refused because the candidate generation was not valid. */
  rejections: number;
  lastFailure: SiteFailure | null;
}

export interface DiscoveryManifest {
  generation: string;
  routes: readonly string[];
}

export type RefreshOutcome =
  | { status: "activated"; generation: string }
  | { status: "unchanged"; generation: string }
  | { status: "rejected"; findings: Finding[] };

/** Where a new candidate generation comes from. Injected so tests can drive it. */
export type SnapshotSource = () => SnapshotBuild;

export class PublishedSite {
  private active: SiteSnapshot | null = null;
  private status: SiteStatus = "unavailable";
  private activations = 0;
  private rejections = 0;
  private lastFailure: SiteFailure | null = null;

  constructor(
    private readonly source: SnapshotSource,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /**
   * Builds a candidate generation and activates it if it is whole.
   *
   * The swap is a single assignment of an already-complete value. Nothing reads
   * a half-built snapshot because a half-built snapshot never becomes reachable
   * — `buildSiteSnapshot` either returns one that validated or returns findings.
   */
  refresh(): RefreshOutcome {
    let build: SnapshotBuild;

    try {
      build = this.source();
    } catch (cause) {
      // A thrown error is the SQLite-went-away case. It is a refresh failure,
      // never a reason to drop the generation already serving.
      build = {
        status: "invalid",
        findings: [
          {
            field: "snapshot",
            code: "snapshot_source_failed",
            severity: "error",
          },
          {
            field: "snapshot.detail",
            code: cause instanceof Error ? cause.message : String(cause),
            severity: "error",
          },
        ],
      };
    }

    if (build.status === "invalid") {
      this.rejections += 1;
      this.lastFailure = {
        at: this.clock().toISOString(),
        findings: build.findings,
      };
      // #34: an invalid new generation never partially replaces the previous
      // one. A warm process stays warm and says it is degraded.
      this.status = this.active ? "degraded" : "unavailable";
      return { status: "rejected", findings: build.findings };
    }

    const candidate = build.snapshot;

    if (this.active?.generation === candidate.generation) {
      // Same content. Re-pointing at an identical generation would invalidate
      // every ETag for no reason.
      this.status = "ready";
      return { status: "unchanged", generation: candidate.generation };
    }

    this.active = candidate;
    this.status = "ready";
    this.activations += 1;
    return { status: "activated", generation: candidate.generation };
  }

  /**
   * Answers one address.
   *
   * Never throws. A caller handling a Visitor request has four outcomes to
   * render and no fifth path to write, which is what stops a storage fault from
   * reaching a Visitor as an unhandled 500.
   */
  resolve(target: PublishedTarget): Resolution {
    const snapshot = this.active;

    if (!snapshot) {
      // #34: an unknown route while no snapshot exists is `unavailable`, not a
      // false 404. Telling a crawler a published URL is gone is not recoverable
      // by the next successful request.
      return {
        outcome: "unavailable",
        reason: this.lastFailure?.findings[0]?.code ?? "no_active_generation",
      };
    }

    const view = this.viewFor(snapshot, target);

    if (!view) {
      return { outcome: "not-found", generation: snapshot.generation };
    }

    const canonicalRoute = canonicalRouteFor(target);

    return {
      outcome: "found",
      target,
      canonicalRoute,
      view,
      generation: snapshot.generation,
      etagSeed: `${snapshot.generation}:${canonicalRoute}`,
    };
  }

  /**
   * Resolves a request URL, applying permanent redirects first.
   *
   * Redirect before lookup, per #34, so a moved route answers `308` to its
   * current canonical address rather than falling through to a `404` on the way.
   * Historical slug redirects arrive with the Publication slice; today the only
   * permanent redirect is the fixed `/home` one, and it is checked here so that
   * the seam already exists when there are more.
   */
  resolveUrl(url: URL): Resolution | null {
    const redirect = fixedRedirectFor(url.pathname);
    if (redirect !== null) {
      return { outcome: "redirect", location: redirect };
    }

    const target = parseTarget(url);

    if (target === null) {
      // A path we own whose address is unusable — a malformed slug, a
      // non-numeric page. The site is the authority on those, and the answer is
      // the same 404 the legacy site gives, not a fall-through to static files.
      if (!ownsPath(url.pathname)) return null;

      return this.active
        ? { outcome: "not-found", generation: this.active.generation }
        : {
            outcome: "unavailable",
            reason:
              this.lastFailure?.findings[0]?.code ?? "no_active_generation",
          };
    }

    return this.resolve(target);
  }

  /**
   * The canonical route manifest, for sitemap generation.
   *
   * Null while no generation exists rather than an empty list: #34 forbids
   * emitting an empty sitemap, which would tell a search engine every published
   * URL had vanished.
   */
  discovery(): DiscoveryManifest | null {
    if (!this.active) return null;

    return {
      generation: this.active.generation,
      routes: this.active.routes,
    };
  }

  state(): PublishedSiteState {
    return {
      status: this.status,
      generation: this.active?.generation ?? null,
      builtAt: this.active?.builtAt ?? null,
      activations: this.activations,
      rejections: this.rejections,
      lastFailure: this.lastFailure,
    };
  }

  /** The active generation, for callers that need to render it directly. */
  snapshot(): SiteSnapshot | null {
    return this.active;
  }

  private viewFor(
    snapshot: SiteSnapshot,
    target: PublishedTarget
  ): PublishedView | null {
    switch (target.kind) {
      case "home":
        return {
          kind: "home",
          home: snapshot.home,
          branding: snapshot.branding,
        };

      case "about":
        return { kind: "about", about: snapshot.about };

      case "blog-collection": {
        const page = pageOf(
          snapshot.blogPosts,
          target.page,
          snapshot.blogPageSize
        );
        return page === null
          ? null
          : {
              kind: "blog-collection",
              page: target.page,
              totalPages: page.totalPages,
              posts: page.items,
            };
      }

      case "project-collection": {
        const page = pageOf(
          snapshot.projects,
          target.page,
          snapshot.projectPageSize
        );
        return page === null
          ? null
          : {
              kind: "project-collection",
              page: target.page,
              totalPages: page.totalPages,
              projects: page.items,
            };
      }

      case "blog-post": {
        const post = snapshot.blogPosts.find(
          (entry) => entry.slug === target.slug
        );
        return post ? { kind: "blog-post", post } : null;
      }

      case "project": {
        const project = snapshot.projects.find(
          (entry) => entry.slug === target.slug
        );
        return project ? { kind: "project", project } : null;
      }
    }
  }
}

/**
 * One page of a collection, or null when the page does not exist.
 *
 * An empty collection still has page 1 — the site shows an empty state there,
 * and 404-ing it would break a link that is in the sitemap.
 */
function pageOf<T>(
  items: readonly T[],
  page: number,
  pageSize: number
): { items: T[]; totalPages: number } | null {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;

  const start = (page - 1) * pageSize;

  return { items: items.slice(start, start + pageSize), totalPages };
}
