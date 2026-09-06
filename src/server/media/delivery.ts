/**
 * Turning a stored asset into a URL a browser may fetch.
 *
 * The whole module exists to keep one property true: **the application builds
 * delivery URLs, and nothing else does.** Content stores a `media_asset_id`,
 * the Owner workspace picks a variant from a closed enum, and the string that
 * reaches the page is assembled here from values the provider itself reported.
 * No caller passes a URL through, and no caller passes transformation syntax.
 *
 * That is why the input is `(MediaAsset, MediaVariant)` rather than the public
 * ID and a transformation: an asset carries the evidence that it is renderable,
 * and refusing to build a URL from an asset that lacks it is the difference
 * between a missing image and a broken one.
 */

import {
  DELIVERY_HOST,
  MEDIA_VARIANTS,
  isMediaVariant,
  type MediaVariant,
  type VariantSpec,
} from "./config";
import type { MediaAsset } from "../database/mediaRepository";

/** What a page needs to place an image without reserving the wrong space. */
export interface RenderedImage {
  url: string;
  width: number;
  height: number;
}

/**
 * Escapes one path segment.
 *
 * Public IDs are application-generated (`portfolio/<uuid>`) for uploads, but
 * legacy ones came from a provider account and may contain characters that
 * change how a URL parses. Encoding per segment preserves the folder separators
 * that are part of the ID while neutralising everything else — notably `..`,
 * which must never be able to climb out of the account's namespace.
 */
function encodeSegments(publicId: string): string | null {
  const segments = publicId.split("/");

  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    return null;
  }

  return segments.map(encodeURIComponent).join("/");
}

/** A short, safe filename hint for Cloudinary's dynamic SEO suffix URL. */
function seoSlug(value: string): string | null {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug || null;
}

/**
 * The size the browser will receive.
 *
 * `fill` crops to the variant's box, so the answer is the variant. `limit`
 * scales down only, so an asset smaller than the cap renders at its own size —
 * computing that here is what keeps `width`/`height` attributes honest and
 * stops the page reflowing once the image arrives.
 */
export function variantDimensions(
  spec: VariantSpec,
  asset: { width: number; height: number }
): { width: number; height: number } {
  if (spec.fit === "fill") {
    return { width: spec.width, height: spec.height };
  }

  if (asset.width <= spec.maxWidth) {
    return { width: asset.width, height: asset.height };
  }

  return {
    width: spec.maxWidth,
    // Rounded the way a renderer scales, and floored at 1 so an extremely wide
    // banner cannot produce a zero-height box.
    height: Math.max(
      1,
      Math.round((asset.height * spec.maxWidth) / asset.width)
    ),
  };
}

/**
 * Builds the delivery URL for an asset, or explains nothing renderable exists.
 *
 * `null` rather than a throw or a placeholder string: a caller rendering a
 * gallery should be able to skip an asset that is mid-upload or deleted without
 * handling an exception, and a placeholder would be indistinguishable from a
 * real URL at the point it gets written into HTML.
 */
export function renderMedia(
  asset: MediaAsset,
  variant: MediaVariant,
  cloudName: string,
  seoSuffix?: string
): RenderedImage | null {
  // Only `ready` assets have been confirmed by the provider. An `uploading` row
  // may describe an asset that never arrived, and a tombstoned or deleted one
  // may no longer exist upstream; both would render as a broken image.
  if (asset.status !== "ready") {
    return null;
  }

  // The database trigger already refuses to mark a row ready without these, so
  // this is defence against a row that predates the trigger or arrived by some
  // other path — not an expected branch.
  if (
    asset.providerVersion === null ||
    asset.format === null ||
    asset.width === null ||
    asset.height === null
  ) {
    return null;
  }

  const publicId = encodeSegments(asset.providerPublicId);
  if (publicId === null || cloudName === "") {
    return null;
  }

  // The type says this cannot fail, but variants reach the renderer from the
  // database and from form submissions, where they are only `string`. Checking
  // here means a caller that forgot `isMediaVariant` gets no image rather than
  // an exception — or, worse, `t_undefined` in a URL.
  if (!isMediaVariant(variant)) {
    return null;
  }

  const spec: VariantSpec = MEDIA_VARIANTS[variant];
  const { width, height } = variantDimensions(spec, {
    width: asset.width,
    height: asset.height,
  });

  // The version segment is what makes this URL safe to cache forever: a
  // replacement is a new asset with a new public ID, so a given URL's bytes
  // never change.
  const suffix = seoSuffix ? seoSlug(seoSuffix) : null;
  const base = `https://${DELIVERY_HOST}/${encodeURIComponent(cloudName)}`;
  const versionedAsset =
    `/t_${variant}/v${encodeURIComponent(asset.providerVersion)}` +
    `/${publicId}`;
  const url = suffix
    ? `${base}/images${versionedAsset}/${suffix}.${asset.format}`
    : `${base}/image/upload${versionedAsset}.${asset.format}`;

  return { url, width, height };
}
