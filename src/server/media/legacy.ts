/**
 * Reading the images this site already has.
 *
 * Two kinds exist today and both have to keep working unchanged until the
 * cutover slice: files served from this origin (`/avatar.webp`,
 * `/public/og.png`) and one absolute Cloudinary URL written by hand into
 * Project frontmatter. Markdown additionally supports a `/images/{slug}/{name}`
 * shorthand that the renderer expands into a Cloudinary URL.
 *
 * The parser here is deliberately separate from the *trusting* of what it
 * finds. Reading a public ID out of a delivery URL tells you what someone typed
 * into a Markdown file; it is not evidence that an asset exists, that it is an
 * image, or that it belongs to the account this application controls. Turning a
 * parse into a Media record therefore goes through `legacyImport.ts`, which
 * asks the provider. This module only ever reports what a string appears to say.
 */

import { DELIVERY_HOST } from "./config";

export type LegacyReference =
  /** Served from this origin; no provider involved. */
  | { kind: "local"; src: string }
  /** Appears to name an asset in a Cloudinary account. Unverified. */
  | {
      kind: "cloudinary";
      cloudName: string;
      publicId: string;
      version: string | null;
      format: string | null;
    }
  /** A remote image this application will not adopt. */
  | { kind: "foreign"; src: string };

/**
 * Recognises a Cloudinary transformation component.
 *
 * Transformation parameters are short prefixed pairs (`c_fill`, `w_300`) joined
 * by commas, which is what separates them from a public ID that merely happens
 * to contain an underscore: `questura_rbayjx` has an eight-letter prefix and so
 * is never mistaken for one.
 */
function isTransformationSegment(segment: string): boolean {
  return segment
    .split(",")
    .every((part) => /^[a-z]{1,3}_[A-Za-z0-9_.:%-]+$/.test(part));
}

function isVersionSegment(segment: string): boolean {
  return /^v[0-9]+$/.test(segment);
}

/**
 * Splits a Cloudinary delivery URL into the parts that identify the asset.
 *
 * The version segment is the reliable boundary between transformations and the
 * public ID. When it is absent the leading transformation-shaped segments are
 * consumed instead, which is the same rule Cloudinary's own URL format implies.
 */
export function parseCloudinaryDeliveryUrl(raw: string): LegacyReference {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "foreign", src: raw };
  }

  if (url.protocol !== "https:" || url.hostname !== DELIVERY_HOST) {
    return { kind: "foreign", src: raw };
  }

  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  // <cloud>/image/upload/... — anything else is a delivery type this
  // application does not render (fetch, private, video, and so on).
  if (
    segments.length < 4 ||
    segments[1] !== "image" ||
    segments[2] !== "upload"
  ) {
    return { kind: "foreign", src: raw };
  }

  const cloudName = decodeURIComponent(segments[0]!);
  let rest = segments.slice(3);

  while (rest.length > 1 && isTransformationSegment(rest[0]!)) {
    rest = rest.slice(1);
  }

  let version: string | null = null;
  if (rest.length > 1 && isVersionSegment(rest[0]!)) {
    version = rest[0]!.slice(1);
    rest = rest.slice(1);
  }

  if (rest.length === 0) {
    return { kind: "foreign", src: raw };
  }

  const path = rest.map(decodeURIComponent).join("/");
  const lastDot = path.lastIndexOf(".");
  // A dot only ends the public ID if it is in the final segment; folders may
  // contain dots too.
  const hasExtension = lastDot > path.lastIndexOf("/") && lastDot !== -1;

  const publicId = hasExtension ? path.slice(0, lastDot) : path;
  const format = hasExtension ? path.slice(lastDot + 1).toLowerCase() : null;

  if (
    publicId === "" ||
    publicId.split("/").some((s) => s === "." || s === "..")
  ) {
    return { kind: "foreign", src: raw };
  }

  return { kind: "cloudinary", cloudName, publicId, version, format };
}

/**
 * Classifies any image reference found in legacy content.
 *
 * Used by the import inventory to decide, per image, whether a Media record can
 * be created from a provider lookup or whether the file has to be uploaded.
 */
export function classifyLegacyImage(src: string): LegacyReference {
  if (src.startsWith("/") && !src.startsWith("//")) {
    return { kind: "local", src };
  }

  return parseCloudinaryDeliveryUrl(src);
}

/**
 * Expands the Markdown `/images/{slug}/{name}` shorthand.
 *
 * The cloud name is a parameter rather than a module constant so the value can
 * come from configuration. The URL shape is frozen: existing published pages
 * contain these strings, and the golden contract asserts they do not move.
 */
export function legacyMarkdownImageUrl(
  slug: string,
  imageName: string,
  cloudName: string
): string {
  return `https://${DELIVERY_HOST}/${cloudName}/image/upload/${slug}/${imageName}`;
}
