/**
 * Storage for media assets.
 *
 * The shape here follows from one rule: the application's record must be
 * written *before* the provider is contacted, and completed only after the
 * provider's answer has been validated. That ordering is what makes an
 * interrupted upload recoverable. If the process dies between the two, what
 * remains is an `uploading` row with a public ID nobody else will ever be
 * given — which is exactly enough information to ask the provider what
 * happened and either finish the job or mark it failed.
 *
 * The reverse ordering (upload first, record afterwards) cannot be recovered
 * from at all: a crash leaves an asset at the provider that the application has
 * no name for, and no way to find.
 */

import { Repository } from "./repository";
import { timestamp } from "../auth/tokens";
import type { AllowedFormat } from "../media/config";

export type MediaStatus =
  | "uploading"
  | "ready"
  | "tombstoned"
  | "delete_pending"
  | "deleted"
  | "failed";

export interface MediaAsset {
  id: string;
  provider: "cloudinary";
  providerAssetId: string | null;
  providerPublicId: string;
  providerVersion: string | null;
  format: AllowedFormat | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  status: MediaStatus;
  originalFilename: string | null;
  altText: string | null;
  digest: string | null;
  createdAt: string;
}

/** What the provider must have told us before an asset can be `ready`. */
export interface ProviderMetadata {
  providerAssetId: string;
  providerVersion: string;
  format: AllowedFormat;
  bytes: number;
  width: number;
  height: number;
}

interface MediaRow {
  id: string;
  provider: "cloudinary";
  provider_asset_id: string | null;
  provider_public_id: string;
  provider_version: string | null;
  format: AllowedFormat | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  status: MediaStatus;
  original_filename: string | null;
  alt_text: string | null;
  digest: string | null;
  created_at: string;
}

function toAsset(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    provider: row.provider,
    providerAssetId: row.provider_asset_id,
    providerPublicId: row.provider_public_id,
    providerVersion: row.provider_version,
    format: row.format,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    status: row.status,
    originalFilename: row.original_filename,
    altText: row.alt_text,
    digest: row.digest,
    createdAt: row.created_at,
  };
}

export class MediaRepository extends Repository {
  /**
   * Claims a local id and a provider public ID before anything is uploaded.
   *
   * The public ID is derived from the local id rather than the filename.
   * Filenames collide, leak information, and are chosen by the uploader; a
   * UUID does none of those things. Because it is deterministic, an upload
   * whose response was lost can be reconciled by asking the provider about this
   * exact public ID.
   */
  beginUpload(
    input: {
      id: string;
      providerPublicId: string;
      originalFilename?: string | null;
      digest?: string | null;
    },
    now: Date = new Date()
  ): MediaAsset {
    const row = this.database
      .query(
        `INSERT INTO media_assets (
           id, provider, provider_public_id, status,
           original_filename, digest, created_at
         ) VALUES (?, 'cloudinary', ?, 'uploading', ?, ?, ?)
         RETURNING *`
      )
      .get(
        input.id,
        input.providerPublicId,
        input.originalFilename ?? null,
        input.digest ?? null,
        timestamp(now)
      ) as MediaRow;

    return toAsset(row);
  }

  /**
   * Records validated provider metadata and marks the asset usable.
   *
   * Only an `uploading` row can be finalized, so a replayed or duplicated
   * finalize cannot revive a failed asset or silently rewrite a ready one's
   * provider identity.
   */
  finalizeUpload(id: string, metadata: ProviderMetadata): MediaAsset | null {
    return this.transaction(() => {
      const row = this.database
        .query(
          `UPDATE media_assets
              SET provider_asset_id = ?,
                  provider_version = ?,
                  format = ?,
                  bytes = ?,
                  width = ?,
                  height = ?,
                  status = 'ready'
            WHERE id = ? AND status = 'uploading'
          RETURNING *`
        )
        .get(
          metadata.providerAssetId,
          metadata.providerVersion,
          metadata.format,
          metadata.bytes,
          metadata.width,
          metadata.height,
          id
        ) as MediaRow | null;

      return row ? toAsset(row) : null;
    });
  }

  /**
   * Abandons an upload.
   *
   * The row is kept rather than deleted. It holds the public ID that may or may
   * not exist at the provider, which is the only thread back to an orphan if
   * one was created.
   */
  markFailed(id: string): void {
    this.database
      .query(
        `UPDATE media_assets
            SET status = 'failed'
          WHERE id = ? AND status = 'uploading'`
      )
      .run(id);
  }

  /**
   * Puts a failed row back into `uploading` so a retry can finish it.
   *
   * Only safe because of how the caller derives identity. The importer's public
   * IDs are a pure function of the image's content hash, so a row that failed
   * can only ever be retried with byte-identical content — the retry cannot
   * rebind a public ID to a different image, which is the thing migration 3's
   * "never reuse a public ID" rule exists to prevent.
   *
   * The digest is therefore required and checked rather than taken on trust: it
   * is the evidence that this is a retry rather than a reuse. A row with no
   * digest (the legacy-adoption path stores none) can never be reclaimed.
   */
  reclaimFailed(id: string, digest: string): MediaAsset | null {
    const row = this.database
      .query(
        `UPDATE media_assets
            SET status = 'uploading'
          WHERE id = ? AND status = 'failed' AND digest IS NOT NULL AND digest = ?
        RETURNING *`
      )
      .get(id, digest) as MediaRow | null;

    return row ? toAsset(row) : null;
  }

  findById(id: string): MediaAsset | null {
    const row = this.database
      .query("SELECT * FROM media_assets WHERE id = ?")
      .get(id) as MediaRow | null;

    return row ? toAsset(row) : null;
  }

  findByPublicId(providerPublicId: string): MediaAsset | null {
    const row = this.database
      .query("SELECT * FROM media_assets WHERE provider_public_id = ?")
      .get(providerPublicId) as MediaRow | null;

    return row ? toAsset(row) : null;
  }

  /**
   * Finds a usable asset holding exactly these bytes.
   *
   * `ready` only, and that is the whole point. A `failed` or `uploading` row
   * with the same digest describes an attempt, not an asset — returning one
   * would hand the caller a record whose provider side may not exist, and the
   * renderer would build a URL for an image that was never stored.
   *
   * Oldest first, so that if two rows somehow tie, the answer is the one every
   * earlier caller already got rather than whichever the planner sorted last.
   */
  findReadyByDigest(digest: string): MediaAsset | null {
    const row = this.database
      .query(
        `SELECT * FROM media_assets
          WHERE digest = ? AND status = 'ready'
          ORDER BY created_at ASC, id ASC
          LIMIT 1`
      )
      .get(digest) as MediaRow | null;

    return row ? toAsset(row) : null;
  }

  listReady(limit = 100): MediaAsset[] {
    const rows = this.database
      .query(
        `SELECT * FROM media_assets
          WHERE status = 'ready'
          ORDER BY created_at DESC
          LIMIT ?`
      )
      .all(limit) as MediaRow[];

    return rows.map(toAsset);
  }
}
