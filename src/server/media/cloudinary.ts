/**
 * The only place that talks to Cloudinary.
 *
 * Like the GitHub identity client, this is an interface first: the upload
 * endpoint's interesting behaviour is what it does with a *bad* provider
 * response — a wrong format, impossible dimensions, a missing asset id — and
 * none of that should need a real Cloudinary account to test.
 *
 * The rule this module enforces at its boundary is that a provider response is
 * untrusted input. Cloudinary is well-behaved, but the application's database
 * has CHECK constraints and its renderer builds URLs from these values, so the
 * response is validated into a narrow shape here rather than being spread
 * across the caller.
 */

import {
  ALLOWED_FORMATS,
  MAX_IMAGE_DIMENSION,
  UPLOAD_PRESET,
  type AllowedFormat,
  type MediaConfig,
} from "./config";
import type { ProviderMetadata } from "../database/mediaRepository";

export type UploadOutcome =
  | { status: "ok"; metadata: ProviderMetadata }
  | { status: "rejected"; reason: string }
  | { status: "unavailable"; reason: string };

export type LookupOutcome =
  | { status: "found"; metadata: ProviderMetadata }
  | { status: "missing" }
  | { status: "unavailable"; reason: string };

export interface MediaProvider {
  /**
   * Uploads bytes under a caller-chosen public ID, never overwriting.
   *
   * `overwrite=false` is not a parameter callers may set. Replacement is
   * modelled as a new asset so that older published revisions keep resolving to
   * the image they were published with, and an overwrite would silently break
   * that for every revision at once.
   */
  upload(
    bytes: Uint8Array,
    publicId: string,
    contentType: string
  ): Promise<UploadOutcome>;

  /**
   * Asks what exists at a public ID.
   *
   * This is the recovery path for an upload whose response was lost. Because
   * public IDs are deterministic and never reused, the answer is unambiguous.
   */
  lookup(publicId: string): Promise<LookupOutcome>;

  /**
   * Deletes an asset, using the immutable asset id as proof rather than as the
   * address.
   *
   * Cloudinary's destroy endpoint addresses assets by public ID and offers no
   * delete-by-asset-id at all, so the id cannot be the address. It is still the
   * authority: the asset currently at that public ID is looked up first and the
   * delete is refused unless its immutable id is the one expected. Deleting by
   * public ID alone would remove whatever happens to live there now.
   */
  destroy(publicId: string, expectedAssetId: string): Promise<boolean>;
}

/** Bounded so a hung provider cannot hold an owner request open indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Content type to the extension used for the multipart filename. */
const UPLOAD_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isAllowedFormat(value: unknown): value is AllowedFormat {
  return (
    typeof value === "string" &&
    (ALLOWED_FORMATS as readonly string[]).includes(value)
  );
}

function positiveInteger(value: unknown, limit: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return null;
  }

  return value > 0 && value <= limit ? value : null;
}

/**
 * Narrows a provider response to the fields the application will store.
 *
 * Every rejection here means the upload does not become usable, which is the
 * safe direction: an asset the application cannot fully describe is one whose
 * delivery URL it cannot correctly build.
 */
export function validateProviderResponse(
  payload: unknown,
  maxBytes: number
): UploadOutcome {
  if (typeof payload !== "object" || payload === null) {
    return { status: "rejected", reason: "provider_response_shape" };
  }

  const body = payload as Record<string, unknown>;

  if (body.resource_type !== "image") {
    return { status: "rejected", reason: "provider_resource_type" };
  }

  if (!isAllowedFormat(body.format)) {
    return { status: "rejected", reason: "provider_format_not_allowed" };
  }

  const bytes = positiveInteger(body.bytes, maxBytes);
  if (bytes === null) {
    return { status: "rejected", reason: "provider_bytes_invalid" };
  }

  const width = positiveInteger(body.width, MAX_IMAGE_DIMENSION);
  const height = positiveInteger(body.height, MAX_IMAGE_DIMENSION);
  if (width === null || height === null) {
    return { status: "rejected", reason: "provider_dimensions_invalid" };
  }

  if (typeof body.asset_id !== "string" || body.asset_id.length === 0) {
    return { status: "rejected", reason: "provider_asset_id_missing" };
  }

  // Cloudinary reports `version` as a number; it is stored as text because it
  // is an opaque identifier that appears in delivery URLs, not a quantity.
  const version = body.version;
  if (
    (typeof version !== "number" || !Number.isSafeInteger(version)) &&
    typeof version !== "string"
  ) {
    return { status: "rejected", reason: "provider_version_missing" };
  }

  if (
    typeof body.secure_url !== "string" ||
    !body.secure_url.startsWith("https://")
  ) {
    return { status: "rejected", reason: "provider_secure_url_missing" };
  }

  return {
    status: "ok",
    metadata: {
      providerAssetId: body.asset_id,
      providerVersion: String(version),
      format: body.format,
      bytes,
      width,
      height,
    },
  };
}

export class CloudinaryProvider implements MediaProvider {
  constructor(private readonly config: MediaConfig) {}

  /**
   * Basic auth with the API key and secret, which is what Cloudinary
   * recommends for server-side uploads. The header is assembled per request and
   * never logged; the secret exists in this file's scope and nowhere else.
   */
  private authorization(): string {
    const credentials = Buffer.from(
      `${this.config.apiKey}:${this.config.apiSecret}`
    ).toString("base64");
    return `Basic ${credentials}`;
  }

  private endpoint(action: string): string {
    return `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      this.config.cloudName
    )}/image/${action}`;
  }

  async upload(
    bytes: Uint8Array,
    publicId: string,
    contentType: string
  ): Promise<UploadOutcome> {
    const form = new FormData();
    // Copied into a plain ArrayBuffer: a Uint8Array may be backed by a
    // SharedArrayBuffer, which `Blob` does not accept.
    //
    // The third argument is not decoration. Without a filename the multipart
    // part carries no `filename` parameter, and Cloudinary answers
    // "Missing required parameter - file" — it identifies the upload by that
    // parameter, not by the field name. This is a constant rather than the
    // uploader's filename for the same reason the public ID is: filenames are
    // attacker-chosen and leak information. The extension is derived from the
    // content type the magic-byte check already agreed with, so it describes
    // the bytes rather than what the client claimed.
    form.append(
      "file",
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType }),
      `upload.${UPLOAD_EXTENSIONS[contentType] ?? "bin"}`
    );
    form.append("public_id", publicId);
    form.append("upload_preset", UPLOAD_PRESET);
    form.append("overwrite", "false");
    // Provider-native recovery is requested per asset even when an account's
    // global backup toggle is later changed. The app-owned R2 copy remains a
    // separate portability layer.
    form.append("backup", "true");
    // Ask the provider to reject anything that is not an image, so the
    // application's magic-byte check is backed by a second opinion rather than
    // being the only one.
    form.append("resource_type", "image");

    let response: Response;
    try {
      response = await fetch(this.endpoint("upload"), {
        method: "POST",
        headers: { Authorization: this.authorization() },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Deliberately not retried. A timed-out upload may well have succeeded,
      // and a blind retry against `overwrite=false` would either duplicate the
      // asset or fail confusingly. Reconciliation goes through `lookup`.
      return { status: "unavailable", reason: "provider_unreachable" };
    }

    if (response.status >= 500) {
      return { status: "unavailable", reason: "provider_server_error" };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "provider_response_body" };
    }

    if (!response.ok) {
      return { status: "rejected", reason: "provider_rejected_upload" };
    }

    return validateProviderResponse(payload, this.config.maxUploadBytes);
  }

  async lookup(publicId: string): Promise<LookupOutcome> {
    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      this.config.cloudName
    )}/resources/image/upload/${encodeURIComponent(publicId)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: this.authorization() },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { status: "unavailable", reason: "provider_unreachable" };
    }

    if (response.status === 404) {
      return { status: "missing" };
    }

    if (!response.ok) {
      return { status: "unavailable", reason: "provider_server_error" };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "provider_response_body" };
    }

    const validated = validateProviderResponse(
      payload,
      this.config.maxUploadBytes
    );

    if (validated.status !== "ok") {
      return { status: "unavailable", reason: validated.reason };
    }

    return { status: "found", metadata: validated.metadata };
  }

  async destroy(publicId: string, expectedAssetId: string): Promise<boolean> {
    // Confirm what is actually there before removing it. An asset already gone
    // is the desired end state, so that counts as success and keeps retries
    // idempotent.
    const existing = await this.lookup(publicId);

    if (existing.status === "missing") {
      return true;
    }

    if (existing.status === "unavailable") {
      return false;
    }

    if (existing.metadata.providerAssetId !== expectedAssetId) {
      // Something else occupies this public ID. Refusing is the only safe
      // answer: the alternative is deleting an asset nobody asked to delete.
      return false;
    }

    try {
      const response = await fetch(this.endpoint("destroy"), {
        method: "POST",
        headers: {
          Authorization: this.authorization(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ public_id: publicId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as { result?: unknown };
      return payload.result === "ok" || payload.result === "not found";
    } catch {
      return false;
    }
  }
}
