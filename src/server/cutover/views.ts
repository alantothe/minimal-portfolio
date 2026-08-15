/**
 * Final Blog-view reconciliation before the seal.
 *
 * JSON stays authoritative through observation so a rollback cannot lose a
 * view. Sealing copies those counts onto SQLite rows keyed by Blog-post ID.
 * The mapping is the slug recorded at import (`imported_from_slug`), not the
 * live Public route — a later slug change must not orphan the count.
 *
 * Spec: #36 section 6 step 7, issue #47.
 */

import type { Database } from "bun:sqlite";
import { JsonViewStore } from "../services/views";
import { shouldCountView } from "../services/viewCooldown";
import type { CutoverPhase } from "../database/repository";
import { cutoverPolicy } from "./policy";

export interface ViewRow {
  slug: string;
  contentId: string | null;
  json: number;
  sqlite: number;
}

export interface ViewReconciliation {
  status: "matched" | "mismatch";
  jsonTotal: number;
  sqliteTotal: number;
  rows: ViewRow[];
}

interface StoredCount {
  content_id: string;
  views: number;
  imported_from_slug: string;
}

function storedCounts(database: Database): StoredCount[] {
  return database
    .query(
      `SELECT content_id, views, imported_from_slug
         FROM content_view_counts`
    )
    .all() as StoredCount[];
}

export function reportViewReconciliation(
  database: Database,
  jsonCounts: Record<string, number>
): ViewReconciliation {
  const sqlite = storedCounts(database);
  const bySlug = new Map(
    sqlite.map((row) => [row.imported_from_slug, row] as const)
  );
  const slugs = [
    ...new Set([...Object.keys(jsonCounts), ...bySlug.keys()]),
  ].sort();
  const rows: ViewRow[] = slugs.map((slug) => {
    const stored = bySlug.get(slug);
    return {
      slug,
      contentId: stored?.content_id ?? null,
      json: jsonCounts[slug] ?? 0,
      sqlite: stored?.views ?? 0,
    };
  });
  const jsonTotal = Object.values(jsonCounts).reduce(
    (sum, count) => sum + count,
    0
  );
  const sqliteTotal = sqlite.reduce((sum, row) => sum + row.views, 0);
  const matched =
    rows.every((row) => row.contentId !== null && row.json === row.sqlite) &&
    jsonTotal === sqliteTotal;

  return {
    status: matched ? "matched" : "mismatch",
    jsonTotal,
    sqliteTotal,
    rows,
  };
}

/**
 * Overwrites SQLite counts from JSON for slugs that already have a row.
 * Unknown slugs are left unmatched so the subsequent report can refuse the seal.
 */
export function applyFinalViewCounts(
  database: Database,
  jsonCounts: Record<string, number>,
  now: Date = new Date()
): void {
  const at = now.toISOString();
  database.transaction(() => {
    for (const [slug, count] of Object.entries(jsonCounts)) {
      const stored = database
        .query(
          `SELECT content_id FROM content_view_counts
            WHERE imported_from_slug = ?`
        )
        .get(slug) as { content_id: string } | null;
      if (!stored) continue;
      database
        .query(
          `UPDATE content_view_counts
              SET views = ?, updated_at = ?
            WHERE content_id = ?`
        )
        .run(count, at, stored.content_id);
    }
  })();
}

const VISITOR_ID = /^[a-zA-Z0-9_-]{16,100}$/;

function requestedViewSlug(url: URL): string | null {
  if (!url.pathname.startsWith("/api/blog/")) return null;
  if (url.searchParams.get("view") !== "1") return null;
  const visitorId = url.searchParams.get("visitor");
  if (visitorId === null || !VISITOR_ID.test(visitorId)) return null;
  const slug = decodeURIComponent(url.pathname.slice("/api/blog/".length));
  if (!slug || slug.includes("/")) return null;
  return slug;
}

function incrementSqliteView(
  database: Database,
  slug: string,
  now: Date
): number {
  const row = database
    .query(
      `SELECT v.content_id AS content_id, v.views AS views
         FROM content_view_counts v
         JOIN content_items c ON c.id = v.content_id
        WHERE c.slug = ? OR v.imported_from_slug = ?
        LIMIT 1`
    )
    .get(slug, slug) as { content_id: string; views: number } | null;
  if (!row) return 0;
  const next = row.views + 1;
  database
    .query(
      `UPDATE content_view_counts
          SET views = ?, updated_at = ?
        WHERE content_id = ?`
    )
    .run(next, now.toISOString(), row.content_id);
  return next;
}

/**
 * Honours the existing Visitor query (`view=1&visitor=`) so Blog view
 * increment behaviour does not change at cutover. JSON remains the store
 * until seal; SQLite takes over afterwards.
 */
export async function recordBlogViewIfRequested(
  url: URL,
  phase: CutoverPhase,
  database?: Database,
  now: Date = new Date()
): Promise<number | null> {
  const slug = requestedViewSlug(url);
  if (slug === null) return null;
  if (!shouldCountView(slug, url.searchParams.get("visitor")!)) return null;

  if (cutoverPolicy(phase).viewsSource === "json") {
    return new JsonViewStore().increment(slug);
  }
  if (!database) {
    throw new Error("SQLite Blog views require an open content database");
  }
  return incrementSqliteView(database, slug, now);
}

export function sqliteViewsBySlug(database: Database): Record<string, number> {
  const rows = database
    .query(
      `SELECT COALESCE(c.slug, v.imported_from_slug) AS slug, v.views AS views
         FROM content_view_counts v
         JOIN content_items c ON c.id = v.content_id`
    )
    .all() as Array<{ slug: string; views: number }>;
  return Object.fromEntries(rows.map((row) => [row.slug, row.views]));
}
