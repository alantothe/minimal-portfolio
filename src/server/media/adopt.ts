/**
 * Turning bytes into a Media asset, with the bytes as the identity.
 *
 * The Owner upload path in `upload.ts` mints a random id per upload, which is
 * right for it: two uploads of the same photograph a month apart are two
 * deliberate acts, and the Owner may want to delete one and keep the other.
 *
 * The importer needs the opposite property. #42's acceptance is that two
 * rehearsals produce *identical* reports, and rehearsals run against a fresh
 * disposable database each time. A random id would make the second report
 * differ from the first in every media field, which would make the acceptance
 * check meaningless — and worse, against a real provider it would upload a
 * second copy of every image on every run.
 *
 * So identity here is the SHA-256 of the content: the local id is a UUIDv5 over
 * that digest, and the provider public ID is derived from the local id. Three
 * things follow, and they are the reason this module exists rather than a flag
 * on `upload.ts`:
 *
 *   1. Re-running the import is free and safe. The second run computes the same
 *      public ID, finds the asset already at the provider, and adopts it
 *      instead of uploading again.
 *   2. A public ID can never be rebound to different content. Migration 3
 *      forbids reusing a public ID because an older published revision must
 *      keep resolving to the image it was published with; content-addressing
 *      makes that violation unrepresentable rather than merely forbidden.
 *   3. The Questurian image can be adopted without the provider's cooperation.
 *      It lives on a cloud these credentials cannot reach, so no Admin API call
 *      can vouch for it — but hashing the bytes we fetched proves what we
 *      stored, which is the stronger claim anyway.
 *
 * What this module does *not* do is decide where bytes come from. A local file
 * and a legacy delivery URL are both just `Uint8Array` by the time they arrive
 * here, which is what keeps the interesting logic testable without a filesystem
 * or a network.
 */

import { createHash } from "node:crypto";
import { uuidV5 } from "../content/identity";
import { detectImageFormat } from "./imageSignature";
import { CONTENT_TYPE_FOR_FORMAT, type MediaConfig } from "./config";
import type { MediaProvider } from "./cloudinary";
import type { MediaAsset, MediaRepository } from "../database/mediaRepository";

/**
 * The namespace for content-addressed media ids.
 *
 * Distinct from the content namespace and from the stub resolver's, so an id
 * derived from image bytes can never collide with one derived from a source key
 * or produced by a rehearsal stub. Never edit it: changing it re-identifies
 * every imported image and orphans anything already pointing at one.
 */
export const MEDIA_CONTENT_NAMESPACE_V1 =
  "0c4a6e21-8f3d-4b56-9a07-e2d84c1b7f90";

export interface AdoptDependencies {
  config: MediaConfig;
  repository: MediaRepository;
  provider: MediaProvider;
}

export type AdoptOutcome =
  | { status: "adopted"; asset: MediaAsset }
  /** These exact bytes already have a usable record. Nothing was uploaded. */
  | { status: "already_adopted"; asset: MediaAsset }
  | { status: "rejected"; reason: string }
  | { status: "unavailable"; reason: string };

export function contentDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The local id these bytes will always have. */
export function contentAddressedId(digest: string): string {
  return uuidV5(digest, MEDIA_CONTENT_NAMESPACE_V1);
}

/**
 * The provider public ID for a local id.
 *
 * Same `portfolio/` prefix the Owner upload path uses, because these assets are
 * indistinguishable once stored — they are all images this application owns and
 * delivers through the same closed set of variants.
 */
export function contentAddressedPublicId(id: string): string {
  return `portfolio/${id}`;
}

export async function adoptImageBytes(
  bytes: Uint8Array,
  dependencies: AdoptDependencies,
  provenance: { originalFilename?: string | null } = {}
): Promise<AdoptOutcome> {
  const { config, repository, provider } = dependencies;

  if (bytes.byteLength === 0) {
    return { status: "rejected", reason: "empty_file" };
  }

  if (bytes.byteLength > config.maxUploadBytes) {
    return { status: "rejected", reason: "file_too_large" };
  }

  // Magic bytes before anything else, exactly as in the Owner upload path. A
  // file's location says nothing about what it contains: `src/public` is in the
  // repository, but "somebody committed it" is not evidence that it is a JPEG.
  const detected = detectImageFormat(bytes);
  if (detected.status === "rejected") {
    return { status: "rejected", reason: detected.reason };
  }

  const digest = contentDigest(bytes);

  // Cheapest question first: are these bytes already here under some other
  // reference? `og.png` serves as both the default sharing image and a Project
  // card, and two references to one file must produce one asset.
  const byDigest = repository.findReadyByDigest(digest);
  if (byDigest) {
    return { status: "already_adopted", asset: byDigest };
  }

  const id = contentAddressedId(digest);
  const publicId = contentAddressedPublicId(id);

  const existing = repository.findByPublicId(publicId);

  if (existing) {
    const resumed = await resume(existing, dependencies, {
      bytes,
      digest,
      publicId,
      contentType: CONTENT_TYPE_FOR_FORMAT[detected.format],
    });

    if (resumed) {
      return resumed;
    }
  }

  let claimed: MediaAsset;
  try {
    claimed = repository.beginUpload({
      id,
      providerPublicId: publicId,
      originalFilename: provenance.originalFilename ?? null,
      digest,
    });
  } catch {
    return { status: "unavailable", reason: "media_storage_unavailable" };
  }

  return store(claimed, dependencies, {
    bytes,
    digest,
    publicId,
    contentType: CONTENT_TYPE_FOR_FORMAT[detected.format],
  });
}

interface StoreContext {
  bytes: Uint8Array;
  digest: string;
  publicId: string;
  contentType: string;
}

/**
 * Deals with a row that already holds this public ID.
 *
 * Returns null when the caller should go on to claim a fresh row, which happens
 * only in the one case where no row is left occupying the ID.
 */
async function resume(
  existing: MediaAsset,
  dependencies: AdoptDependencies,
  context: StoreContext
): Promise<AdoptOutcome | null> {
  const { repository } = dependencies;

  if (existing.status === "ready") {
    // Reachable when the row predates digests — the legacy-adoption path in
    // `legacyImport.ts` stores none — so the digest lookup above missed it.
    return { status: "already_adopted", asset: existing };
  }

  if (existing.status === "uploading") {
    // An import that died between claiming the row and hearing back from the
    // provider. The public ID is deterministic, so asking about it answers
    // precisely.
    return store(existing, dependencies, context);
  }

  if (existing.status === "failed") {
    const reclaimed = repository.reclaimFailed(existing.id, context.digest);

    if (!reclaimed) {
      // The digest did not match, so this ID belongs to different content.
      // Under content addressing that should be impossible; refusing is the
      // only safe answer if it ever happens.
      return { status: "rejected", reason: "media_asset_identity_conflict" };
    }

    return store(reclaimed, dependencies, context);
  }

  // `tombstoned`, `delete_pending`, `deleted`. Somebody decided this image
  // should go away. Silently resurrecting it during an import would undo that
  // decision without anyone being asked.
  return { status: "rejected", reason: `media_asset_${existing.status}` };
}

/**
 * Gets the bytes to the provider and completes the row.
 *
 * Every branch that cannot complete the row marks it failed rather than
 * deleting it. The row holds the public ID, which is the only thread back to an
 * asset that may or may not exist at the provider; deleting the row would leave
 * an orphan nobody could ever find. Unlike `upload.ts`, this path never asks
 * the provider to destroy anything — an import is an auditable operation, and a
 * public ID that can only ever hold these exact bytes is not an orphan worth a
 * destructive call to clean up.
 */
async function store(
  claimed: MediaAsset,
  dependencies: AdoptDependencies,
  context: StoreContext
): Promise<AdoptOutcome> {
  const { repository, provider } = dependencies;

  const uploaded = await provider.upload(
    context.bytes,
    context.publicId,
    context.contentType
  );

  if (uploaded.status === "ok") {
    return finalize(claimed, dependencies, uploaded.metadata);
  }

  // Both remaining cases ask the same question, for the same reason: the
  // provider may already hold this asset. With `overwrite=false` and a public
  // ID derived from the content, a rejection most often means "a previous run
  // already uploaded exactly this", and an ambiguous failure may have stored it
  // before the connection dropped. Asking is safe and answers precisely; a
  // blind retry would not.
  const reconciled = await provider.lookup(context.publicId);

  if (reconciled.status === "found") {
    return finalize(claimed, dependencies, reconciled.metadata);
  }

  repository.markFailed(claimed.id);

  return uploaded.status === "rejected"
    ? { status: "rejected", reason: uploaded.reason }
    : { status: "unavailable", reason: uploaded.reason };
}

function finalize(
  claimed: MediaAsset,
  dependencies: AdoptDependencies,
  metadata: Parameters<MediaRepository["finalizeUpload"]>[1]
): AdoptOutcome {
  const finalized = dependencies.repository.finalizeUpload(
    claimed.id,
    metadata
  );

  if (!finalized) {
    dependencies.repository.markFailed(claimed.id);
    return { status: "unavailable", reason: "media_storage_unavailable" };
  }

  return { status: "adopted", asset: finalized };
}
