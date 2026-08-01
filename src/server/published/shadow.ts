/**
 * Comparing the database renderer against the frozen legacy contract, without
 * serving a byte of it.
 *
 * #43's acceptance is that every difference between the two renderers is either
 * zero or *explicitly* allowlisted as a safe-renderer difference. The word doing
 * the work there is "explicitly": a comparison that reported "mostly the same"
 * would be worthless, because the whole risk of this migration is a small
 * difference nobody looked at.
 *
 * So the classifier has no fuzzy matching and no tolerance. Every difference is
 * matched against a named rule with a stated reason, and anything that matches
 * no rule diverges and blocks. Adding a rule is a deliberate act with a
 * justification attached, which is exactly the review conversation this slice is
 * supposed to force.
 *
 * The comparison is against the **slice 1 golden contract**, not against a live
 * legacy crawl. The contract is the frozen description of what the site did
 * before any of this started; diffing against a running legacy renderer would
 * quietly absorb any drift that happened in between.
 */

import type { RouteSnapshot, SeoSnapshot } from "../../baseline/contract";
import { normalizeVisibleText } from "../../baseline/normalize";

/**
 * The two raw bodies for one JSON route.
 *
 * The `baseline` side is a *live* legacy render, not a value from the contract —
 * the contract stores only a hash. The caller must prove that live render still
 * hashes to what the contract recorded before handing it over.
 */
export interface PayloadPair {
  baseline: string;
  published: string;
}

export interface Difference {
  path: string;
  baseline: unknown;
  published: unknown;
}

export interface ClassifiedDifference extends Difference {
  /** The rule that explains this difference, or null if nothing does. */
  rule: string | null;
  reason: string | null;
}

export type RouteParityStatus =
  "identical" | "allowlisted" | "diverged" | "excluded" | "missing";

export interface RouteParity {
  path: string;
  status: RouteParityStatus;
  differences: ClassifiedDifference[];
}

export interface ParityReport {
  generation: string;
  routes: RouteParity[];
  totals: Record<RouteParityStatus, number>;
  /** True when every route is identical or fully explained. */
  passed: boolean;
}

interface DifferenceRule {
  id: string;
  reason: string;
  matches(difference: Difference): boolean;
}

const CLOUDINARY_PREFIX = "https://res.cloudinary.com/";

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * An image reference as the site addressed it *before* the migration.
 *
 * Three spellings, all of them legitimate in the frozen contract: a
 * repository-relative path (`/avatar.webp`), the same asset written absolutely
 * because SEO metadata requires it (`https://baseline.test/public/og.png`), and
 * the one project card that already lived in the old Cloudinary account with a
 * hand-written transformation.
 */
function isLegacyAssetReference(value: unknown): boolean {
  if (!isString(value) || !IMAGE_EXTENSION.test(value)) return false;

  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    const url = new URL(value);
    // Anything already delivered through the closed variant enum is the
    // migration's *output*, so it cannot also be its input.
    return url.protocol === "https:" && !isAdoptedAsset(value);
  } catch {
    return false;
  }
}

/**
 * An image delivered by this application through the closed variant enum.
 *
 * The `t_<variant>/v<version>` shape is the whole point of the check. A bare
 * Cloudinary URL proves nothing — the legacy card was one, with an inline
 * `c_fill,w_300,h_180` transformation. Requiring a named transformation is what
 * makes this rule assert "the renderer built this URL from a variant it was
 * allowed to ask for" rather than merely "the host is Cloudinary".
 */
function isAdoptedAsset(value: unknown): boolean {
  return (
    isString(value) &&
    value.startsWith(CLOUDINARY_PREFIX) &&
    /\/image\/upload\/t_[a-z0-9_]+\/v\d+\//.test(value)
  );
}

/**
 * The field a payload path ends at, ignoring where in the structure it sits.
 *
 * The same field appears at two depths — `payload.metadata.year` on a detail
 * route and `payload.projects[3].year` in a list — and they are the same fact
 * about the same Project. Matching on the leaf keeps one rule covering both
 * rather than two rules that could drift apart, while the `payload.` prefix
 * check keeps the rules from reaching outside JSON comparison.
 */
function payloadField(path: string): string | null {
  if (!path.startsWith("payload")) return null;

  const leaf = path.slice(path.lastIndexOf(".") + 1);
  return leaf === path ? null : leaf;
}

/**
 * The differences a reviewer has agreed are safe.
 *
 * Each one is narrow on purpose. `media-adoption` does not say "image fields may
 * differ" — it says a repository-relative image path may become a Cloudinary
 * delivery URL, and nothing else. An image URL that changed to a *different*
 * repository path, or to an empty string, still diverges.
 */
export const SAFE_RENDERER_RULES: DifferenceRule[] = [
  {
    id: "rendered-markup",
    reason:
      "The restricted Markdown renderer emits different markup from marked for the same content. Meaning is compared separately through textHash, headings, internalLinks, images and seo, none of which are allowlisted.",
    matches: (difference) => difference.path === "bodyHash",
  },
  {
    id: "media-adoption",
    reason:
      "Slices 4 and 5 moved repository images to the media provider, with each asset's identity proved by content digest (#57). The bytes are the same; the URL that delivers them is not.",
    matches: (difference) =>
      /^(images\[\d+\]\.src|seo\.(ogImage|twitterImage)|payload(\.\w+|\[\d+\])*\.(image|sharingImage))$/.test(
        difference.path
      ) &&
      isLegacyAssetReference(difference.baseline) &&
      isAdoptedAsset(difference.published),
  },
  {
    id: "structured-data-image",
    reason:
      "The Person schema's portrait is the same adopted asset, delivered from the media provider.",
    matches: (difference) =>
      difference.path.startsWith("seo.structuredData") &&
      isLegacyAssetReference(difference.baseline) &&
      isAdoptedAsset(difference.published),
  },
  {
    id: "period-is-text",
    reason:
      '#36 maps the legacy Project `year` onto the editable `period`, which is text: the two live Projects disagreed about the YAML type (a quoted "2025–present" and a bare 2026) and both are the same editorial value. The rendered page is identical; only the JSON type changed, and the SPA renders this field from server markup rather than reading it.',
    matches: (difference) =>
      payloadField(difference.path) === "year" &&
      typeof difference.baseline === "number" &&
      difference.published === String(difference.baseline),
  },
  {
    id: "accent-normalized",
    reason:
      "The content model normalises an accent colour to lower case. The value is identical to a browser; only its spelling in the payload changed.",
    matches: (difference) =>
      payloadField(difference.path) === "accent" &&
      isString(difference.baseline) &&
      isString(difference.published) &&
      difference.baseline.toLowerCase() === difference.published.toLowerCase(),
  },
  {
    id: "private-field-removed",
    reason:
      "#34 requires public JSON to carry only safe public fields. `order` is the display-order storage column and `date` is migration provenance (#36); the legacy handler leaked both by returning raw frontmatter. Neither is read by the SPA, which consumes only `html`, `content` and `seo`.",
    matches: (difference) =>
      ["order", "date"].includes(payloadField(difference.path) ?? "") &&
      difference.published === undefined &&
      difference.baseline !== undefined,
  },
  {
    id: "absent-optional-field",
    reason:
      "An optional field the legacy frontmatter omitted entirely is stored as an explicit null. Both serialise as absent-or-null to any consumer.",
    matches: (difference) =>
      difference.baseline === undefined && difference.published === null,
  },
  {
    id: "alt-text-required",
    reason:
      "#32 requires alt text to publish a meaningful image. The legacy project card rendered an empty alt; the imported record carries the project title, which the importer reported as derived rather than invented.",
    matches: (difference) =>
      /^images\[\d+\]\.alt$/.test(difference.path) &&
      difference.baseline === "" &&
      isString(difference.published) &&
      difference.published !== "",
  },
];

function classify(difference: Difference): ClassifiedDifference {
  const rule = SAFE_RENDERER_RULES.find((candidate) =>
    candidate.matches(difference)
  );

  return {
    ...difference,
    rule: rule?.id ?? null,
    reason: rule?.reason ?? null,
  };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareScalar(
  path: string,
  baseline: unknown,
  published: unknown,
  into: Difference[]
): void {
  if (!equal(baseline, published)) {
    into.push({ path, baseline, published });
  }
}

/**
 * Compares two lists element by element.
 *
 * Length differences are reported as their own difference rather than being
 * folded into a whole-list mismatch, because "the published page has one fewer
 * heading" and "one heading is worded differently" need different answers and a
 * single opaque diff of the two arrays would not distinguish them.
 */
function compareList(
  path: string,
  baseline: unknown[],
  published: unknown[],
  into: Difference[]
): void {
  if (baseline.length !== published.length) {
    into.push({
      path: `${path}.length`,
      baseline: baseline.length,
      published: published.length,
    });
  }

  const length = Math.min(baseline.length, published.length);
  for (let index = 0; index < length; index += 1) {
    compareScalar(`${path}[${index}]`, baseline[index], published[index], into);
  }
}

type ImageSnapshotList = RouteSnapshot["images"];
type Image = ImageSnapshotList[number];

/**
 * Whether a published image could be the same picture as a baseline one.
 *
 * Used only to *pair* the two lists. It deliberately does not decide whether the
 * pairing is acceptable — once paired, the actual field differences are emitted
 * and the allowlist rules judge them by name. A matcher that both paired and
 * excused would be an allowlist nobody could review.
 */
function couldBeSameImage(baseline: Image, published: Image): boolean {
  const sameSource =
    baseline.src === published.src ||
    (isLegacyAssetReference(baseline.src) && isAdoptedAsset(published.src));

  const sameAlt =
    baseline.alt === published.alt ||
    (baseline.alt === "" && published.alt !== null && published.alt !== "");

  return sameSource && sameAlt;
}

/**
 * Compares two image lists as sets rather than by position.
 *
 * The golden contract sorts images by `src`, which was the right call for a
 * stable artifact but makes positional comparison meaningless here: adopting
 * `/avatar.webp` into a `res.cloudinary.com` URL moves it to the other end of
 * the sort, and every index after it shifts. Comparing by index would report
 * three differences for one asset and pair the avatar against the logo.
 *
 * So each baseline image is matched to a published one — exact matches first, so
 * a relaxed match cannot steal a counterpart an exact match needed — and the
 * differences are reported against the baseline image's index.
 */
function compareImages(
  baseline: ImageSnapshotList,
  published: ImageSnapshotList,
  into: Difference[]
): void {
  const unmatched = published.map((image, index) => ({ image, index }));
  const pairs = new Map<number, Image>();

  const claim = (
    baselineIndex: number,
    predicate: (candidate: Image) => boolean
  ): boolean => {
    const found = unmatched.findIndex((entry) => predicate(entry.image));
    if (found === -1) return false;

    pairs.set(baselineIndex, unmatched.splice(found, 1)[0]!.image);
    return true;
  };

  const pending: number[] = [];

  baseline.forEach((image, index) => {
    const exact = (candidate: Image) =>
      candidate.src === image.src && candidate.alt === image.alt;

    if (!claim(index, exact)) pending.push(index);
  });

  for (const index of pending) {
    const image = baseline[index]!;
    if (claim(index, (candidate) => couldBeSameImage(image, candidate))) {
      continue;
    }

    into.push({
      path: `images[${index}].missing`,
      baseline: image,
      published: null,
    });
  }

  for (const [index, candidate] of pairs) {
    compareScalar(
      `images[${index}].src`,
      baseline[index]!.src,
      candidate.src,
      into
    );
    compareScalar(
      `images[${index}].alt`,
      baseline[index]!.alt,
      candidate.alt,
      into
    );
  }

  for (const leftover of unmatched) {
    into.push({
      path: `images.unexpected[${leftover.index}]`,
      baseline: null,
      published: leftover.image,
    });
  }
}

function compareSeo(
  baseline: SeoSnapshot | null,
  published: SeoSnapshot | null,
  into: Difference[]
): void {
  if (baseline === null || published === null) {
    compareScalar("seo", baseline, published, into);
    return;
  }

  for (const key of Object.keys(baseline) as Array<keyof SeoSnapshot>) {
    if (key === "structuredData") continue;
    compareScalar(`seo.${key}`, baseline[key], published[key], into);
  }

  compareStructuredData(
    baseline.structuredData,
    published.structuredData,
    into
  );
}

/**
 * Compares JSON-LD leaf by leaf.
 *
 * A whole-document hash would report the Person schema's portrait URL as "the
 * structured data changed", which is true and useless. Walking to the leaves is
 * what lets `structured-data-image` explain that one field and leave every other
 * field of the same document still being checked.
 */
function compareStructuredData(
  baseline: unknown[],
  published: unknown[],
  into: Difference[]
): void {
  if (baseline.length !== published.length) {
    into.push({
      path: "seo.structuredData.length",
      baseline: baseline.length,
      published: published.length,
    });
    return;
  }

  baseline.forEach((entry, index) => {
    walk(`seo.structuredData[${index}]`, entry, published[index], into);
  });
}

function walk(
  path: string,
  baseline: unknown,
  published: unknown,
  into: Difference[]
): void {
  const bothObjects =
    baseline !== null &&
    published !== null &&
    typeof baseline === "object" &&
    typeof published === "object" &&
    !Array.isArray(baseline) &&
    !Array.isArray(published);

  if (bothObjects) {
    const keys = new Set([
      ...Object.keys(baseline as object),
      ...Object.keys(published as object),
    ]);

    for (const key of keys) {
      walk(
        `${path}.${key}`,
        (baseline as Record<string, unknown>)[key],
        (published as Record<string, unknown>)[key],
        into
      );
    }
    return;
  }

  if (Array.isArray(baseline) && Array.isArray(published)) {
    compareList(path, baseline, published, into);
    return;
  }

  compareScalar(path, baseline, published, into);
}

/**
 * Fields whose value is rendered markup rather than data.
 *
 * Compared as normalized visible text, because the two renderers legitimately
 * produce different markup for the same words. Everything *around* them — the
 * title, the page name, the stylesheet, every SEO field, the view count — is
 * still compared exactly.
 */
const MARKUP_FIELDS = new Set(["content", "html", "githubActivityPanel"]);

/**
 * Compares two JSON payloads structurally.
 *
 * This exists because `bodyHash` is the *only* axis the golden contract records
 * for a JSON route — there are no headings or images to extract from an API
 * response. Allowlisting `rendered-markup` therefore left every JSON route
 * effectively unchecked, which is half the site's public surface. Walking the
 * parsed payloads restores the check.
 *
 * The published body is compared against the *live* legacy body rather than
 * against the contract, because the contract stores a hash and a hash cannot be
 * diffed. The caller is responsible for first proving that the live legacy body
 * still matches the contract's hash; with that established, this comparison is
 * transitively a comparison against the frozen contract.
 */
export function compareJsonPayloads(
  baselineBody: string,
  publishedBody: string,
  normalizeMarkup: (html: string) => string
): Difference[] {
  const differences: Difference[] = [];

  let baseline: unknown;
  let published: unknown;

  try {
    baseline = JSON.parse(baselineBody);
    published = JSON.parse(publishedBody);
  } catch {
    differences.push({
      path: "payload",
      baseline: "unparseable",
      published: "unparseable",
    });
    return differences;
  }

  walkPayload("payload", baseline, published, differences, normalizeMarkup);
  return differences;
}

function walkPayload(
  path: string,
  baseline: unknown,
  published: unknown,
  into: Difference[],
  normalizeMarkup: (html: string) => string
): void {
  const key = path.slice(path.lastIndexOf(".") + 1);

  if (
    MARKUP_FIELDS.has(key) &&
    typeof baseline === "string" &&
    typeof published === "string"
  ) {
    compareScalar(
      `${path}#text`,
      normalizeMarkup(baseline),
      normalizeMarkup(published),
      into
    );
    return;
  }

  const bothObjects =
    baseline !== null &&
    published !== null &&
    typeof baseline === "object" &&
    typeof published === "object" &&
    !Array.isArray(baseline) &&
    !Array.isArray(published);

  if (bothObjects) {
    const keys = new Set([
      ...Object.keys(baseline as object),
      ...Object.keys(published as object),
    ]);

    for (const entry of keys) {
      walkPayload(
        `${path}.${entry}`,
        (baseline as Record<string, unknown>)[entry],
        (published as Record<string, unknown>)[entry],
        into,
        normalizeMarkup
      );
    }
    return;
  }

  if (Array.isArray(baseline) && Array.isArray(published)) {
    if (baseline.length !== published.length) {
      into.push({
        path: `${path}.length`,
        baseline: baseline.length,
        published: published.length,
      });
      return;
    }

    baseline.forEach((entry, index) => {
      walkPayload(
        `${path}[${index}]`,
        entry,
        published[index],
        into,
        normalizeMarkup
      );
    });
    return;
  }

  compareScalar(path, baseline, published, into);
}

/** Everything the two renderers might disagree about, for one route. */
export function compareRoute(
  baseline: RouteSnapshot,
  published: RouteSnapshot,
  payload?: PayloadPair
): RouteParity {
  const differences: Difference[] = [];

  compareScalar("status", baseline.status, published.status, differences);
  compareScalar(
    "contentType",
    baseline.contentType,
    published.contentType,
    differences
  );
  compareScalar(
    "cacheControl",
    baseline.cacheControl,
    published.cacheControl,
    differences
  );
  compareScalar("location", baseline.location, published.location, differences);
  compareScalar("bodyHash", baseline.bodyHash, published.bodyHash, differences);
  compareScalar("textHash", baseline.textHash, published.textHash, differences);
  compareList("headings", baseline.headings, published.headings, differences);
  compareList(
    "internalLinks",
    baseline.internalLinks,
    published.internalLinks,
    differences
  );
  compareImages(baseline.images, published.images, differences);
  compareSeo(baseline.seo, published.seo, differences);

  if (payload) {
    differences.push(
      ...compareJsonPayloads(
        payload.baseline,
        payload.published,
        normalizeVisibleText
      )
    );
  }

  const classified = differences.map(classify);

  return {
    path: baseline.path,
    status:
      classified.length === 0
        ? "identical"
        : classified.some((difference) => difference.rule === null)
          ? "diverged"
          : "allowlisted",
    differences: classified,
  };
}

/**
 * The whole report.
 *
 * A route present in the contract but absent from the published crawl is
 * `missing` and fails the run. Silently comparing only what both sides happened
 * to produce is how a dropped route survives a parity gate.
 */
export function compareContract(
  generation: string,
  baseline: RouteSnapshot[],
  published: Map<string, RouteSnapshot>,
  /**
   * Routes this module knowingly does not own, each with a stated reason.
   * Anything absent from both the crawl and this set is `missing` and fails —
   * silently comparing only what both sides produced is how a dropped route
   * survives a parity gate.
   */
  excluded: Map<string, string> = new Map(),
  payloads: Map<string, PayloadPair> = new Map()
): ParityReport {
  const routes = baseline.map((snapshot) => {
    const candidate = published.get(snapshot.path);

    if (!candidate) {
      const reason = excluded.get(snapshot.path);

      return {
        path: snapshot.path,
        status: (reason ? "excluded" : "missing") as RouteParityStatus,
        differences: reason
          ? [
              {
                path: "route",
                baseline: "covered by the golden contract",
                published: "not owned by PublishedSite",
                rule: "not-owned",
                reason,
              },
            ]
          : [],
      };
    }

    return compareRoute(snapshot, candidate, payloads.get(snapshot.path));
  });

  const totals: Record<RouteParityStatus, number> = {
    identical: 0,
    allowlisted: 0,
    diverged: 0,
    excluded: 0,
    missing: 0,
  };

  for (const route of routes) totals[route.status] += 1;

  return {
    generation,
    routes,
    totals,
    passed: totals.diverged === 0 && totals.missing === 0,
  };
}

/** The report as text, for a runner's stdout and a PR body. */
export function formatParityReport(report: ParityReport): string {
  const lines = [
    `generation ${report.generation}`,
    `identical ${report.totals.identical}  allowlisted ${report.totals.allowlisted}` +
      `  excluded ${report.totals.excluded}  diverged ${report.totals.diverged}` +
      `  missing ${report.totals.missing}`,
    "",
  ];

  for (const route of report.routes) {
    if (route.status === "identical" || route.status === "excluded") continue;

    lines.push(`${route.status.toUpperCase()} ${route.path}`);

    for (const difference of route.differences) {
      lines.push(
        `  ${difference.rule ?? "UNEXPLAINED"} ${difference.path}` +
          `\n    baseline:  ${JSON.stringify(difference.baseline)}` +
          `\n    published: ${JSON.stringify(difference.published)}`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}
