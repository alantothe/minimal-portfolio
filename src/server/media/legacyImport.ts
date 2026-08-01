/**
 * Adopting an image that predates this application's records.
 *
 * The rule from the migration plan is that **a parsed delivery URL is not proof
 * of identity**. The Cloudinary URL sitting in Project frontmatter was typed by
 * a person; it says a public ID exists under a cloud, but not that the asset is
 * still there, that it is an image, what format it really is, or what its
 * dimensions are. Recording it as a Media asset on the strength of the string
 * would put unverified values into the table the renderer builds URLs from.
 *
 * So the import goes: parse, then *ask the provider*, then store only what the
 * provider answered. The URL contributes exactly one thing — the public ID to
 * ask about. Format, version, dimensions, byte count, and the immutable asset
 * id all come from the Admin API response, which `validateProviderResponse`
 * has already narrowed.
 *
 * The write ordering matches `upload.ts` for the same recovery reason: an
 * `uploading` row is claimed first, so an interrupted import leaves a row that
 * names the asset rather than nothing at all.
 */

import { randomUUID } from "node:crypto";
import { parseCloudinaryDeliveryUrl } from "./legacy";
import type { MediaProvider } from "./cloudinary";
import type { MediaAsset, MediaRepository } from "../database/mediaRepository";

export interface LegacyImportDependencies {
  repository: MediaRepository;
  provider: MediaProvider;
  /**
   * The cloud the provider is authenticated against.
   *
   * A URL naming a different cloud is refused rather than looked up: the
   * provider would answer about whatever happens to sit at that public ID in
   * *our* account, which is a different asset that would then be recorded under
   * the legacy URL's identity.
   */
  cloudName: string;
}

export type LegacyImportOutcome =
  | { status: "imported"; asset: MediaAsset }
  /** The public ID already has a record. Import is idempotent by public ID. */
  | { status: "already_imported"; asset: MediaAsset }
  | { status: "rejected"; reason: string }
  | { status: "unavailable"; reason: string };

export async function importLegacyCloudinaryImage(
  deliveryUrl: string,
  dependencies: LegacyImportDependencies
): Promise<LegacyImportOutcome> {
  const { repository, provider, cloudName } = dependencies;

  const parsed = parseCloudinaryDeliveryUrl(deliveryUrl);

  if (parsed.kind !== "cloudinary") {
    return { status: "rejected", reason: "not_a_cloudinary_delivery_url" };
  }

  if (parsed.cloudName !== cloudName) {
    return { status: "rejected", reason: "legacy_cloud_mismatch" };
  }

  // Checked before the network call: re-running the import over an inventory
  // should be cheap and must not spend a provider request per already-known
  // asset.
  const existing = repository.findByPublicId(parsed.publicId);
  if (existing) {
    return existing.status === "ready"
      ? { status: "already_imported", asset: existing }
      : { status: "rejected", reason: "legacy_asset_record_incomplete" };
  }

  const found = await provider.lookup(parsed.publicId);

  if (found.status === "missing") {
    return { status: "rejected", reason: "legacy_asset_not_found" };
  }

  if (found.status === "unavailable") {
    // Not recorded as failed: nothing was claimed yet, and a provider outage
    // must leave the inventory re-runnable rather than poisoned.
    return { status: "unavailable", reason: found.reason };
  }

  let claimed: MediaAsset;
  try {
    claimed = repository.beginUpload({
      id: randomUUID(),
      providerPublicId: parsed.publicId,
      // Provenance, not a filename on disk. Kept because it is the only record
      // of where this asset came from once the Markdown file stops being
      // authoritative.
      originalFilename: parsed.publicId.split("/").pop() ?? null,
      digest: null,
    });
  } catch {
    return { status: "unavailable", reason: "media_storage_unavailable" };
  }

  const finalized = repository.finalizeUpload(claimed.id, found.metadata);

  if (!finalized) {
    repository.markFailed(claimed.id);
    return { status: "unavailable", reason: "media_storage_unavailable" };
  }

  return { status: "imported", asset: finalized };
}
