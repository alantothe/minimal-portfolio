/**
 * The golden contract: a frozen, reproducible description of everything the
 * public site does today.
 *
 * Later migration slices move content into a different runtime model. Nothing
 * in those slices may change what a Visitor sees, and this artifact is how that
 * claim is proved: capture the contract now, re-capture it after each slice, and
 * diff. An unexplained difference blocks the change.
 *
 * Every value recorded here must be derived only from committed repository
 * state. Anything that varies by clock, network, or deployment is either pinned
 * (see `environment.ts`) or deliberately excluded.
 */

/** Bumped only when the shape of the artifact changes, never when content does. */
export const BASELINE_VERSION = 1;

/**
 * Canonical URLs embed an origin. Production and local development disagree
 * about that origin, so the capture pins a sentinel instead. The contract then
 * describes route structure rather than the hostname of whoever ran it.
 */
export const BASELINE_ORIGIN = "https://baseline.test";

export const BASELINE_ARTIFACT_PATH = "baseline/golden-contract.json";

/** Search and social metadata rendered into a server-rendered page. */
export interface SeoSnapshot {
  title: string | null;
  description: string | null;
  canonical: string | null;
  ogSiteName: string | null;
  ogType: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  articlePublishedTime: string | null;
  structuredData: unknown[];
}

export interface ImageSnapshot {
  src: string;
  alt: string | null;
}

/**
 * What one public route returned. HTML routes record structure and meaning;
 * JSON routes record a hash of their key-sorted payload.
 */
export interface RouteSnapshot {
  path: string;
  kind: RouteKind;
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  /** Present only for redirects. */
  location: string | null;
  /**
   * SHA-256 of the response body, the strictest signal available. JSON payloads
   * are key-sorted first, because key order belongs to whichever renderer
   * produced them rather than to what a Visitor receives.
   */
  bodyHash: string;
  /** SHA-256 of visible text with markup and whitespace normalized away. */
  textHash: string | null;
  headings: string[];
  internalLinks: string[];
  images: ImageSnapshot[];
  seo: SeoSnapshot | null;
}

export type RouteKind =
  | "health"
  | "discovery"
  | "page"
  | "collection"
  | "blog-post"
  | "project"
  | "redirect"
  | "api"
  | "not-found";

export interface RouteRequest {
  path: string;
  kind: RouteKind;
}

export interface FileFingerprint {
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * Blog view totals are runtime state, not repository content. They are recorded
 * so the cutover slice can prove no Blog view was lost, and are read from the
 * committed store so a capture stays reproducible.
 */
export interface ViewFingerprint {
  source: string;
  perSlug: Record<string, number>;
  total: number;
}

export interface GoldenContract {
  version: number;
  origin: string;
  routes: RouteSnapshot[];
  content: FileFingerprint[];
  media: FileFingerprint[];
  views: ViewFingerprint;
}
