/**
 * Final Blog-view reconciliation before seal.
 *
 * Counts stay in the JSON store through `sqlite-observation` so a rollback
 * cannot lose a view. Sealing copies the JSON totals onto SQLite rows keyed
 * by Blog-post ID (via the slug recorded at import). Totals must match
 * exactly; an orphan JSON slug or a missing SQLite row blocks the seal.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { importedContentId } from "../content/identity";
import { migratedDatabase, seedPublishedSite } from "../published/fixtures";
import {
  applyFinalViewCounts,
  recordBlogViewIfRequested,
  reportViewReconciliation,
} from "./views";

const directories: string[] = [];
const previousViewsFile = process.env.BLOG_VIEWS_FILE;

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
  if (previousViewsFile === undefined) {
    delete process.env.BLOG_VIEWS_FILE;
  } else {
    process.env.BLOG_VIEWS_FILE = previousViewsFile;
  }
});

describe("Blog view reconciliation", () => {
  test("applying the JSON counts makes per-post and total views match", () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    seedPublishedSite(database);
    const contentId = importedContentId("blog_post", "first-post");
    database
      .query(
        `INSERT INTO content_view_counts
           (content_id, views, imported_from_slug, updated_at)
         VALUES (?, 2, 'first-post', '2026-08-01T00:00:00.000Z')`
      )
      .run(contentId);

    const jsonCounts = { "first-post": 5 };
    expect(reportViewReconciliation(database, jsonCounts)).toEqual({
      status: "mismatch",
      jsonTotal: 5,
      sqliteTotal: 2,
      rows: [
        {
          slug: "first-post",
          contentId,
          json: 5,
          sqlite: 2,
        },
      ],
    });

    applyFinalViewCounts(
      database,
      jsonCounts,
      new Date("2026-08-15T12:00:00Z")
    );

    expect(reportViewReconciliation(database, jsonCounts)).toEqual({
      status: "matched",
      jsonTotal: 5,
      sqliteTotal: 5,
      rows: [
        {
          slug: "first-post",
          contentId,
          json: 5,
          sqlite: 5,
        },
      ],
    });

    database.close();
  });

  test("an orphan JSON slug blocks a match", () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    seedPublishedSite(database);

    const report = reportViewReconciliation(database, {
      "missing-post": 3,
    });

    expect(report.status).toBe("mismatch");
    expect(report.rows).toEqual([
      {
        slug: "missing-post",
        contentId: null,
        json: 3,
        sqlite: 0,
      },
    ]);

    database.close();
  });
});

describe("Blog view recording", () => {
  test("sqlite-observation records a view in JSON when the Visitor query asks", async () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    const file = `${directory}/blog-views.json`;
    process.env.BLOG_VIEWS_FILE = file;

    const counted = await recordBlogViewIfRequested(
      new URL(
        "https://example.test/api/blog/first-post?view=1&visitor=visitor-12345678"
      ),
      "sqlite-observation"
    );

    expect(counted).toBe(1);
    expect(JSON.parse(await Bun.file(file).text())).toEqual({
      "first-post": 1,
    });

    const ignored = await recordBlogViewIfRequested(
      new URL("https://example.test/api/blog/first-post"),
      "sqlite-observation"
    );
    expect(ignored).toBeNull();

    database.close();
  });

  test("sealed records a view on the SQLite Blog-post row", async () => {
    const { database, directory } = migratedDatabase();
    directories.push(directory);
    seedPublishedSite(database);
    const contentId = importedContentId("blog_post", "first-post");
    database
      .query(
        `INSERT INTO content_view_counts
           (content_id, views, imported_from_slug, updated_at)
         VALUES (?, 4, 'first-post', '2026-08-01T00:00:00.000Z')`
      )
      .run(contentId);

    const counted = await recordBlogViewIfRequested(
      new URL(
        "https://example.test/api/blog/first-post?view=1&visitor=visitor-abcdefgh"
      ),
      "sealed",
      database
    );

    expect(counted).toBe(5);
    expect(
      (
        database
          .query(`SELECT views FROM content_view_counts WHERE content_id = ?`)
          .get(contentId) as { views: number }
      ).views
    ).toBe(5);

    database.close();
  });
});
