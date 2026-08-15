/** Immutable publication history and route ownership. */

import { createHash, randomUUID } from "node:crypto";
import { Repository } from "./repository";
import { ContentRepository, type ContentItem } from "./contentRepository";
import type { ContentType } from "../content/identity";
import { stableStringify } from "../content/stableJson";
import { publicRouteFor } from "../content/address";

export type PublicationSource = "publish" | "restore-publish" | "migration";

export interface RevisionSnapshot {
  id: string;
  type: ContentType;
  slug: string | null;
  schemaVersion: number;
  data: unknown;
  displayOrder: number | null;
  publishedAt: string | null;
}

export interface PublishedRevision {
  id: string;
  contentId: string;
  revisionNumber: number;
  schemaVersion: number;
  snapshot: RevisionSnapshot;
  source: PublicationSource;
  actorGithubUserId: number | null;
  publishedAt: string;
  note: string | null;
  checksum: string;
  restoredFromRevisionId: string | null;
}

export interface PublishedRequest {
  revision: PublishedRevision;
  requestFingerprint: string;
}

interface RevisionRow {
  id: string;
  content_id: string;
  revision_number: number;
  schema_version: number;
  snapshot: string;
  source: PublicationSource;
  actor_github_user_id: number | null;
  published_at: string;
  note: string | null;
  checksum: string;
  restored_from_revision_id: string | null;
}

export function revisionSnapshot(item: ContentItem): RevisionSnapshot {
  return {
    id: item.id,
    type: item.type,
    slug: item.slug,
    schemaVersion: item.schemaVersion,
    data: item.data,
    displayOrder: item.displayOrder,
    publishedAt: item.publishedAt,
  };
}

export function revisionChecksum(snapshot: RevisionSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

export function publicationRequestFingerprint(input: {
  contentId: string;
  expectedDraftVersion: number;
  note: string | null;
}): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function toRevision(row: RevisionRow): PublishedRevision {
  return {
    id: row.id,
    contentId: row.content_id,
    revisionNumber: row.revision_number,
    schemaVersion: row.schema_version,
    snapshot: JSON.parse(row.snapshot) as RevisionSnapshot,
    source: row.source,
    actorGithubUserId: row.actor_github_user_id,
    publishedAt: row.published_at,
    note: row.note,
    checksum: row.checksum,
    restoredFromRevisionId: row.restored_from_revision_id,
  };
}

export class PublicationRepository extends Repository {
  findRequest(idempotencyKey: string): PublishedRequest | null {
    const row = this.database
      .query(
        `SELECT revision.*, request.request_fingerprint FROM publication_requests request
           JOIN published_revisions revision ON revision.id = request.revision_id
          WHERE request.idempotency_key = ?`
      )
      .get(idempotencyKey) as
      (RevisionRow & { request_fingerprint: string }) | null;
    return row
      ? {
          revision: toRevision(row),
          requestFingerprint: row.request_fingerprint,
        }
      : null;
  }

  findRevision(id: string): PublishedRevision | null {
    const row = this.database
      .query("SELECT * FROM published_revisions WHERE id = ?")
      .get(id) as RevisionRow | null;
    return row ? toRevision(row) : null;
  }

  currentRevision(contentId: string): PublishedRevision | null {
    const row = this.database
      .query(
        `SELECT revision.* FROM content_items content
           JOIN published_revisions revision
             ON revision.id = content.current_published_revision_id
          WHERE content.id = ?`
      )
      .get(contentId) as RevisionRow | null;
    return row ? toRevision(row) : null;
  }

  listRevisions(contentId: string): PublishedRevision[] {
    return (
      this.database
        .query(
          `SELECT * FROM published_revisions
            WHERE content_id = ? ORDER BY revision_number DESC`
        )
        .all(contentId) as RevisionRow[]
    ).map(toRevision);
  }

  /** Current immutable revisions, shaped for the existing snapshot builder. */
  listPublishedContent(): ContentItem[] {
    const rows = this.database
      .query(
        `SELECT revision.* FROM content_items content
           JOIN published_revisions revision
             ON revision.id = content.current_published_revision_id
          ORDER BY CASE revision.content_id WHEN '' THEN 1 ELSE 0 END,
                   revision.content_id`
      )
      .all() as RevisionRow[];

    return rows.map((row) => {
      const snapshot = JSON.parse(row.snapshot) as RevisionSnapshot;
      return {
        ...snapshot,
        origin: "owner",
        ownerEditedAt: null,
        deletedAt: null,
        createdAt: row.published_at,
        updatedAt: row.published_at,
        draftVersion: 1,
        basePublishedRevisionId: row.id,
        currentPublishedRevisionId: row.id,
        restoredFromRevisionId: row.restored_from_revision_id,
      };
    });
  }

  nextRevisionNumber(contentId: string): number {
    const row = this.database
      .query(
        `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next
           FROM published_revisions WHERE content_id = ?`
      )
      .get(contentId) as { next: number };
    return row.next;
  }

  routeOwner(route: string): string | null {
    const row = this.database
      .query("SELECT content_id FROM published_routes WHERE route = ?")
      .get(route) as { content_id: string } | null;
    return row?.content_id ?? null;
  }

  insertRevision(input: {
    item: ContentItem;
    source: Exclude<PublicationSource, "migration">;
    actorGithubUserId: number;
    note: string | null;
    idempotencyKey: string;
    expectedDraftVersion: number;
    requestFingerprint: string;
    now: Date;
  }): PublishedRevision {
    const id = randomUUID();
    const at = input.now.toISOString();
    const snapshot = revisionSnapshot(input.item);
    const checksum = revisionChecksum(snapshot);
    const revisionNumber = this.nextRevisionNumber(input.item.id);
    const row = this.database
      .query(
        `INSERT INTO published_revisions (
           id, content_id, revision_number, schema_version, snapshot, source,
           actor_github_user_id, published_at, note, checksum,
           restored_from_revision_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(
        id,
        input.item.id,
        revisionNumber,
        input.item.schemaVersion,
        JSON.stringify(snapshot),
        input.source,
        input.actorGithubUserId,
        at,
        input.note,
        checksum,
        input.item.restoredFromRevisionId
      ) as RevisionRow;

    this.database
      .query(
        `UPDATE content_items
            SET current_published_revision_id = ?,
                base_published_revision_id = ?,
                restored_from_revision_id = NULL,
                slug = ?, data = ?, schema_version = ?, display_order = ?,
                published_at = ?, updated_at = ?,
                draft_version = draft_version + 1
          WHERE id = ? AND draft_version = ?`
      )
      .run(
        id,
        id,
        snapshot.slug,
        JSON.stringify(snapshot.data),
        snapshot.schemaVersion,
        snapshot.displayOrder,
        snapshot.publishedAt,
        at,
        input.item.id,
        input.expectedDraftVersion
      );

    this.database
      .query(
        `INSERT INTO publication_requests (
           idempotency_key, content_id, expected_draft_version,
           request_fingerprint, revision_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.idempotencyKey,
        input.item.id,
        input.expectedDraftVersion,
        input.requestFingerprint,
        id,
        at
      );
    this.database
      .query(
        `INSERT INTO publication_audit
           (id, event, content_id, revision_id, actor_github_user_id, occurred_at, detail)
         VALUES (?, 'publish', ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.item.id,
        id,
        input.actorGithubUserId,
        at,
        input.note
      );
    this.database
      .query(
        `UPDATE publication_state
            SET site_generation = site_generation + 1, updated_at = ? WHERE id = 1`
      )
      .run(at);

    return toRevision(row);
  }

  /** Establishes or advances the accepted baseline during a controlled import. */
  seedMigrationRevision(item: ContentItem, now: Date): PublishedRevision {
    const id = randomUUID();
    const at = now.toISOString();
    const snapshot = revisionSnapshot(item);
    const row = this.database
      .query(
        `INSERT INTO published_revisions (
           id, content_id, revision_number, schema_version, snapshot, source,
           actor_github_user_id, published_at, note, checksum,
           restored_from_revision_id
         ) VALUES (?, ?, ?, ?, ?, 'migration', NULL, ?, ?, ?, NULL)
         RETURNING *`
      )
      .get(
        id,
        item.id,
        this.nextRevisionNumber(item.id),
        item.schemaVersion,
        JSON.stringify(snapshot),
        at,
        "Imported content baseline",
        revisionChecksum(snapshot)
      ) as RevisionRow;
    this.database
      .query(
        `UPDATE content_items
            SET current_published_revision_id = ?, base_published_revision_id = ?
          WHERE id = ?`
      )
      .run(id, id, item.id);
    const route = publicRouteFor(item);
    if (route) this.activateRoute(item.id, route, id);
    this.database
      .query(
        `UPDATE publication_state
            SET site_generation = site_generation + 1, updated_at = ? WHERE id = 1`
      )
      .run(at);
    return toRevision(row);
  }

  /**
   * Resumable post-migration backfill for content accepted before revisions
   * existed. JavaScript computes the real SHA-256 checksum; SQL random bytes
   * would only look like integrity metadata without protecting anything.
   */
  reconcileImportedBaselines(now: Date = new Date()): number {
    return this.transaction(() => {
      const ids = this.database
        .query(
          `SELECT id FROM content_items
            WHERE deleted_at IS NULL
              AND current_published_revision_id IS NULL
              AND origin = 'import'
              AND owner_edited_at IS NULL`
        )
        .all() as Array<{ id: string }>;
      const content = new ContentRepository(this.database);
      let seeded = 0;
      for (const { id } of ids) {
        const item = content.findById(id);
        if (!item) continue;
        this.seedMigrationRevision(item, now);
        seeded += 1;
      }
      return seeded;
    });
  }

  activateRoute(contentId: string, route: string, revisionId: string): void {
    this.database
      .query("UPDATE published_routes SET is_current = 0 WHERE content_id = ?")
      .run(contentId);
    this.database
      .query(
        `INSERT INTO published_routes
           (route, content_id, is_current, first_revision_id, last_revision_id)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (route) DO UPDATE SET
           is_current = 1, last_revision_id = excluded.last_revision_id`
      )
      .run(route, contentId, revisionId, revisionId);
  }

  routeRedirects(): Record<string, string> {
    const rows = this.database
      .query(
        `SELECT old.route AS source, current.route AS destination
           FROM published_routes old
           JOIN published_routes current
             ON current.content_id = old.content_id AND current.is_current = 1
          WHERE old.is_current = 0 AND old.route <> current.route`
      )
      .all() as Array<{ source: string; destination: string }>;
    return Object.fromEntries(rows.map((row) => [row.source, row.destination]));
  }

  restoreRevision(input: {
    revision: PublishedRevision;
    currentPublicSlug: string | null;
    expectedDraftVersion: number;
    actorGithubUserId: number;
    now: Date;
  }): number | null {
    const snapshot = input.revision.snapshot;
    const at = input.now.toISOString();
    const result = this.database
      .query(
        `UPDATE content_items
            SET slug = ?, data = ?, schema_version = ?, display_order = ?,
                published_at = ?, restored_from_revision_id = ?,
                owner_edited_at = ?, updated_at = ?,
                draft_version = draft_version + 1
          WHERE id = ? AND draft_version = ? AND deleted_at IS NULL
        RETURNING draft_version`
      )
      .get(
        input.currentPublicSlug,
        JSON.stringify(snapshot.data),
        snapshot.schemaVersion,
        snapshot.displayOrder,
        snapshot.publishedAt,
        input.revision.id,
        at,
        at,
        input.revision.contentId,
        input.expectedDraftVersion
      ) as { draft_version: number } | null;
    if (!result) return null;
    this.database
      .query(
        `INSERT INTO publication_audit
           (id, event, content_id, revision_id, actor_github_user_id, occurred_at, detail)
         VALUES (?, 'restore', ?, ?, ?, ?, NULL)`
      )
      .run(
        randomUUID(),
        input.revision.contentId,
        input.revision.id,
        input.actorGithubUserId,
        at
      );
    return result.draft_version;
  }
}
