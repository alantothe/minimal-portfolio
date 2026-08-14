/**
 * Storage for editable content.
 *
 * Two responsibilities beyond the usual read and write.
 *
 * **Provenance.** #36 allows a re-import to replace migration-created data
 * *only* while the Owner has not touched it, and refuses once they have. That
 * rule is only enforceable if the database remembers which rows the import
 * created and which have since been edited, so `origin` and `owner_edited_at`
 * are recorded on every write rather than inferred later from timestamps.
 *
 * **Schema version.** Every row carries the version it was written under, and
 * reads refuse a version this release does not understand. Failing closed is
 * the point: a release that renders content it cannot fully interpret publishes
 * something nobody wrote.
 */

import { Repository } from "./repository";
import { CONTENT_SCHEMA_VERSION } from "../content/schema";
import {
  isSingletonType,
  type ContentType,
  type SingletonType,
} from "../content/identity";

export type ContentOrigin = "import" | "owner";

export interface ContentItem {
  id: string;
  type: ContentType;
  slug: string | null;
  schemaVersion: number;
  data: unknown;
  displayOrder: number | null;
  publishedAt: string | null;
  origin: ContentOrigin;
  ownerEditedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContentRow {
  id: string;
  type: ContentType;
  slug: string | null;
  schema_version: number;
  data: string;
  display_order: number | null;
  published_at: string | null;
  origin: ContentOrigin;
  owner_edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly contentId: string,
    readonly found: number
  ) {
    super(
      `Content ${contentId} uses schema version ${found}, which this release does not support`
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

function toItem(row: ContentRow): ContentItem {
  if (row.schema_version > CONTENT_SCHEMA_VERSION) {
    // Newer than this release. Refusing is the safe direction: a rollback to an
    // older release must not silently render content written by a newer one
    // with fields it does not know to include.
    throw new UnsupportedSchemaVersionError(row.id, row.schema_version);
  }

  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    schemaVersion: row.schema_version,
    data: JSON.parse(row.data),
    displayOrder: row.display_order,
    publishedAt: row.published_at,
    origin: row.origin,
    ownerEditedAt: row.owner_edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function timestamp(now: Date): string {
  return now.toISOString();
}

/** Optimistic-concurrency versions must advance even within one millisecond. */
function nextTimestamp(previous: string, now: Date): string {
  return new Date(
    Math.max(now.getTime(), Date.parse(previous) + 1)
  ).toISOString();
}

export interface WriteContentInput {
  id: string;
  type: ContentType;
  slug?: string | null;
  data: unknown;
  displayOrder?: number | null;
  publishedAt?: string | null;
  origin: ContentOrigin;
}

export type ConditionalContentUpdate =
  | { status: "updated"; item: ContentItem }
  | { status: "not-found" }
  | { status: "conflict"; currentUpdatedAt: string };

export class ContentRepository extends Repository {
  /**
   * Inserts a content item.
   *
   * Deliberately not an upsert. The import needs to know the difference between
   * "created" and "already there" to produce an honest reconciliation report,
   * and an upsert would erase that distinction at exactly the moment it matters.
   */
  create(input: WriteContentInput, now: Date = new Date()): ContentItem {
    const at = timestamp(now);

    const row = this.database
      .query(
        `INSERT INTO content_items (
           id, type, slug, schema_version, data,
           display_order, published_at, origin, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      )
      .get(
        input.id,
        input.type,
        input.slug ?? null,
        CONTENT_SCHEMA_VERSION,
        JSON.stringify(input.data),
        input.displayOrder ?? null,
        input.publishedAt ?? null,
        input.origin,
        at,
        at
      ) as ContentRow;

    return toItem(row);
  }

  /**
   * Replaces the stored snapshot.
   *
   * `origin` is not a parameter: a row's provenance is set once, at creation.
   * What changes is `owner_edited_at`, and only when the Owner is the editor —
   * that timestamp is the flag a later re-import checks before overwriting.
   */
  update(
    id: string,
    changes: {
      slug?: string | null;
      data?: unknown;
      displayOrder?: number | null;
      publishedAt?: string | null;
    },
    editor: ContentOrigin,
    now: Date = new Date()
  ): ContentItem | null {
    return this.transaction(() => {
      const existing = this.database
        .query("SELECT * FROM content_items WHERE id = ?")
        .get(id) as ContentRow | null;

      if (!existing || existing.deleted_at !== null) return null;

      const at = timestamp(now);
      const ownerEditedAt = editor === "owner" ? at : existing.owner_edited_at;

      const row = this.database
        .query(
          `UPDATE content_items
              SET slug = ?,
                  data = ?,
                  schema_version = ?,
                  display_order = ?,
                  published_at = ?,
                  owner_edited_at = ?,
                  updated_at = ?
            WHERE id = ?
          RETURNING *`
        )
        .get(
          changes.slug === undefined ? existing.slug : changes.slug,
          changes.data === undefined
            ? existing.data
            : JSON.stringify(changes.data),
          CONTENT_SCHEMA_VERSION,
          changes.displayOrder === undefined
            ? existing.display_order
            : changes.displayOrder,
          changes.publishedAt === undefined
            ? existing.published_at
            : changes.publishedAt,
          ownerEditedAt,
          at,
          id
        ) as ContentRow;

      return toItem(row);
    });
  }

  /**
   * Replaces a draft only when the caller edited the version it last read.
   *
   * Autosave can come from two tabs or from a delayed request. Without this
   * comparison, whichever request arrives last wins even when it was written
   * against older content. The check and write share one transaction so no
   * writer can move the row between them.
   */
  updateIfCurrent(
    id: string,
    changes: {
      slug?: string | null;
      data?: unknown;
      displayOrder?: number | null;
      publishedAt?: string | null;
    },
    editor: ContentOrigin,
    expectedUpdatedAt: string,
    now: Date = new Date()
  ): ConditionalContentUpdate {
    return this.transaction(() => {
      const existing = this.database
        .query("SELECT * FROM content_items WHERE id = ?")
        .get(id) as ContentRow | null;

      if (!existing || existing.deleted_at !== null) {
        return { status: "not-found" };
      }
      if (existing.updated_at !== expectedUpdatedAt) {
        return {
          status: "conflict",
          currentUpdatedAt: existing.updated_at,
        };
      }

      const at = nextTimestamp(existing.updated_at, now);
      const ownerEditedAt = editor === "owner" ? at : existing.owner_edited_at;
      const row = this.database
        .query(
          `UPDATE content_items
              SET slug = ?,
                  data = ?,
                  schema_version = ?,
                  display_order = ?,
                  published_at = ?,
                  owner_edited_at = ?,
                  updated_at = ?
            WHERE id = ? AND updated_at = ?
          RETURNING *`
        )
        .get(
          changes.slug === undefined ? existing.slug : changes.slug,
          changes.data === undefined
            ? existing.data
            : JSON.stringify(changes.data),
          CONTENT_SCHEMA_VERSION,
          changes.displayOrder === undefined
            ? existing.display_order
            : changes.displayOrder,
          changes.publishedAt === undefined
            ? existing.published_at
            : changes.publishedAt,
          ownerEditedAt,
          at,
          id,
          expectedUpdatedAt
        ) as ContentRow | null;

      // Defensive: another writer cannot interleave inside this transaction,
      // but treating a missing RETURNING row as conflict is safer than saying
      // an autosave succeeded when it did not.
      if (!row) {
        const current = this.database
          .query("SELECT updated_at FROM content_items WHERE id = ?")
          .get(id) as { updated_at: string } | null;
        return current
          ? { status: "conflict", currentUpdatedAt: current.updated_at }
          : { status: "not-found" };
      }

      return { status: "updated", item: toItem(row) };
    });
  }

  findById(id: string): ContentItem | null {
    const row = this.database
      .query("SELECT * FROM content_items WHERE id = ? AND deleted_at IS NULL")
      .get(id) as ContentRow | null;

    return row ? toItem(row) : null;
  }

  /** Identity/history lookup that deliberately includes tombstoned content. */
  findIncludingArchivedById(id: string): ContentItem | null {
    const row = this.database
      .query("SELECT * FROM content_items WHERE id = ?")
      .get(id) as ContentRow | null;

    return row ? toItem(row) : null;
  }

  findBySlug(type: ContentType, slug: string): ContentItem | null {
    const row = this.database
      .query("SELECT * FROM content_items WHERE type = ? AND slug = ?")
      .get(type, slug) as ContentRow | null;

    return row ? toItem(row) : null;
  }

  findSingleton(type: SingletonType): ContentItem | null {
    const row = this.database
      .query(
        "SELECT * FROM content_items WHERE type = ? AND deleted_at IS NULL"
      )
      .get(type) as ContentRow | null;

    return row ? toItem(row) : null;
  }

  /** Projects in the Owner's order; Blog posts newest first. */
  list(type: ContentType): ContentItem[] {
    if (isSingletonType(type)) {
      const single = this.findSingleton(type);
      return single ? [single] : [];
    }

    const order =
      type === "project"
        ? "display_order ASC, created_at ASC"
        : "published_at DESC, created_at DESC";

    const rows = this.database
      .query(
        `SELECT * FROM content_items
          WHERE type = ? AND deleted_at IS NULL
          ORDER BY ${order}`
      )
      .all(type) as ContentRow[];

    return rows.map(toItem);
  }

  /** Every slug already taken in a collection, for collision suggestions. */
  takenSlugs(type: ContentType): Set<string> {
    const rows = this.database
      .query(
        "SELECT slug FROM content_items WHERE type = ? AND slug IS NOT NULL"
      )
      .all(type) as { slug: string }[];

    return new Set(rows.map((row) => row.slug));
  }

  /**
   * Removes a collection item from the current draft without erasing identity.
   *
   * Former slugs remain in this table and therefore remain reserved. The same
   * row can also continue satisfying revision and import-ledger references.
   */
  archiveIfCurrent(
    id: string,
    expectedUpdatedAt: string,
    now: Date = new Date()
  ): ConditionalContentUpdate {
    return this.transaction(() => {
      const existing = this.database
        .query("SELECT * FROM content_items WHERE id = ?")
        .get(id) as ContentRow | null;

      if (!existing || existing.deleted_at !== null) {
        return { status: "not-found" };
      }
      if (isSingletonType(existing.type)) {
        return { status: "not-found" };
      }
      if (existing.updated_at !== expectedUpdatedAt) {
        return {
          status: "conflict",
          currentUpdatedAt: existing.updated_at,
        };
      }

      const at = nextTimestamp(existing.updated_at, now);
      const row = this.database
        .query(
          `UPDATE content_items
              SET deleted_at = ?, owner_edited_at = ?, updated_at = ?
            WHERE id = ? AND updated_at = ? AND deleted_at IS NULL
          RETURNING *`
        )
        .get(at, at, at, id, expectedUpdatedAt) as ContentRow | null;

      if (!row) {
        const current = this.database
          .query(
            "SELECT updated_at, deleted_at FROM content_items WHERE id = ?"
          )
          .get(id) as Pick<ContentRow, "updated_at" | "deleted_at"> | null;
        return current && current.deleted_at === null
          ? { status: "conflict", currentUpdatedAt: current.updated_at }
          : { status: "not-found" };
      }

      return { status: "updated", item: toItem(row) };
    });
  }

  /**
   * Whether a re-import may overwrite this row.
   *
   * #36's rule, in one place: import-created and never edited by the Owner. A
   * missing row is replaceable because there is nothing to lose.
   */
  isReplaceableByImport(id: string): boolean {
    const row = this.database
      .query("SELECT origin, owner_edited_at FROM content_items WHERE id = ?")
      .get(id) as Pick<ContentRow, "origin" | "owner_edited_at"> | null;

    if (!row) return true;

    return row.origin === "import" && row.owner_edited_at === null;
  }

  countByType(): Record<string, number> {
    const rows = this.database
      .query("SELECT type, COUNT(*) AS total FROM content_items GROUP BY type")
      .all() as { type: string; total: number }[];

    return Object.fromEntries(rows.map((row) => [row.type, row.total]));
  }
}
