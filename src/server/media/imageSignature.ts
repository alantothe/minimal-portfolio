/**
 * Deciding what a file actually is, from its bytes.
 *
 * The filename extension and the browser's `Content-Type` are both chosen by
 * whoever is uploading. Neither is evidence. This module looks at the leading
 * bytes instead, and the format it reports is the only one the rest of the
 * upload path will believe.
 *
 * It is deliberately strict rather than clever. An unknown container, a
 * truncated header, or an animated image is refused instead of being guessed
 * at — the set of things this portfolio needs to accept is three still image
 * formats, and anything outside that set has no business reaching the provider.
 *
 * SVG is refused explicitly and by name. It is not really an image format for
 * these purposes: it is an XML document that can carry script, and serving one
 * from the site's own origin would hand an attacker script execution there.
 */

import type { AllowedFormat } from "./config";

export type SignatureResult =
  | { status: "ok"; format: AllowedFormat }
  | { status: "rejected"; reason: string };

function startsWith(
  bytes: Uint8Array,
  signature: number[],
  offset = 0
): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }

  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return startsWith(
    bytes,
    [...text].map((character) => character.charCodeAt(0)),
    offset
  );
}

const JPEG_START = [0xff, 0xd8, 0xff];
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

/**
 * WebP is a RIFF container: "RIFF", four length bytes, then "WEBP", then a
 * chunk identifying the variant. `VP8 ` and `VP8L` are still images; `VP8X` is
 * the extended form, which is the one that can carry animation.
 */
function inspectWebp(bytes: Uint8Array): SignatureResult {
  if (bytes.length < 16) {
    return { status: "rejected", reason: "truncated_webp_header" };
  }

  const chunk = String.fromCharCode(...bytes.slice(12, 16));

  if (chunk === "VP8 " || chunk === "VP8L") {
    return { status: "ok", format: "webp" };
  }

  if (chunk === "VP8X") {
    // Bit 1 of the VP8X flags byte marks an animation.
    const flags = bytes[20] ?? 0;
    if ((flags & 0b0000_0010) !== 0) {
      return { status: "rejected", reason: "animated_images_not_supported" };
    }

    return { status: "ok", format: "webp" };
  }

  return { status: "rejected", reason: "unrecognised_webp_variant" };
}

/**
 * The format these bytes really are, or why they were refused.
 *
 * `declaredType` is accepted only so that a mismatch can be reported as a
 * distinct reason. It never influences the detected format.
 */
export function detectImageFormat(
  bytes: Uint8Array,
  declaredType?: string | null
): SignatureResult {
  if (bytes.length === 0) {
    return { status: "rejected", reason: "empty_file" };
  }

  if (bytes.length < 12) {
    return { status: "rejected", reason: "truncated_file" };
  }

  let detected: AllowedFormat | null = null;

  if (startsWith(bytes, JPEG_START)) {
    detected = "jpg";
  } else if (startsWith(bytes, PNG_START)) {
    detected = "png";
  } else if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    const webp = inspectWebp(bytes);
    if (webp.status === "rejected") {
      return webp;
    }
    detected = webp.format;
  }

  if (!detected) {
    // Named refusals for the formats somebody will predictably try, so the
    // rejection explains itself rather than looking like a corrupt upload.
    if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) {
      return { status: "rejected", reason: "gif_not_supported" };
    }

    if (looksLikeSvg(bytes)) {
      return { status: "rejected", reason: "svg_not_supported" };
    }

    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
      return { status: "rejected", reason: "pdf_not_supported" };
    }

    return { status: "rejected", reason: "unsupported_image_format" };
  }

  if (declaredType && !typeMatchesFormat(declaredType, detected)) {
    return { status: "rejected", reason: "declared_type_mismatch" };
  }

  return { status: "ok", format: detected };
}

/**
 * SVG has no magic number. It is XML, so it may open with a declaration, a
 * comment, a doctype, or the `<svg` element itself, possibly after whitespace
 * or a byte-order mark. Rather than try to parse it, this looks for an `<svg`
 * tag anywhere in the opening bytes — enough to name the refusal, and the
 * catch-all rejection below covers anything this misses.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const opening = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 1024))
    .toLowerCase();

  return opening.includes("<svg");
}

const TYPE_ALIASES: Record<AllowedFormat, string[]> = {
  jpg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  webp: ["image/webp"],
};

function typeMatchesFormat(
  declaredType: string,
  format: AllowedFormat
): boolean {
  const normalized = declaredType.split(";")[0]!.trim().toLowerCase();
  return TYPE_ALIASES[format].includes(normalized);
}
