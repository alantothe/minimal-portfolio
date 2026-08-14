/**
 * The ordered schema history.
 *
 * Discipline, enforced by the runner in `migrator.ts`:
 *
 * - Migrations are append-only. Never edit or renumber one that has shipped;
 *   the runner checksums applied migrations and refuses to start if one changed
 *   underneath it.
 * - Changes are additive (expand-contract). Add a column or table, backfill,
 *   move reads, and only drop the old shape in a later migration once no
 *   running release depends on it. A deploy replaces one running container, so
 *   for a moment neither release should be broken by the schema.
 */

export interface Migration {
  id: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "create_system_state",
    statements: [
      // The cutover from repository content to database content runs through an
      // explicit persisted phase rather than an informal flag, so a restart can
      // never lose track of which content source is authoritative. Slice 2 only
      // establishes it; `legacy` means nothing reads from this database yet.
      `CREATE TABLE system_state (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         cutover_phase TEXT NOT NULL
           CHECK (cutover_phase IN (
             'legacy',
             'shadow',
             'sqlite-observation',
             'sealed'
           )),
         updated_at TEXT NOT NULL
       )`,
      `INSERT INTO system_state (id, cutover_phase, updated_at)
       VALUES (1, 'legacy', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ],
  },
  {
    id: 2,
    name: "create_owner_auth",
    statements: [
      // One in-flight sign-in attempt. Three separate secrets are stored per
      // attempt because they defend against different things: the state proves
      // the callback belongs to a redirect this server started, the attempt
      // token proves it reached the same browser that started it, and the PKCE
      // verifier proves the code is being redeemed by the party that requested
      // it. Only the verifier is stored in the clear — it is what gets sent
      // back to GitHub — while the other two are stored as digests, so a
      // database read cannot be replayed into a session.
      `CREATE TABLE oauth_attempts (
         attempt_token_digest TEXT PRIMARY KEY,
         state_digest TEXT NOT NULL UNIQUE,
         pkce_verifier TEXT NOT NULL,
         created_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         consumed_at TEXT
       )`,
      // Expired attempts are swept on write rather than by a background timer,
      // so the index that makes the sweep cheap is the one the sweep uses.
      `CREATE INDEX oauth_attempts_expires_at ON oauth_attempts (expires_at)`,

      // The session token itself is never stored. The browser holds the only
      // copy; the database holds its SHA-256 digest, so a leaked database
      // backup cannot be turned into a signed-in browser.
      //
      // Both expiries are absolute timestamps rather than durations, because a
      // duration has to be re-evaluated against a clock the caller supplies,
      // and every such caller is a chance to accidentally extend a session that
      // should have ended. `absolute_expires_at` is written once and never
      // updated.
      `CREATE TABLE owner_sessions (
         token_digest TEXT PRIMARY KEY,
         github_user_id INTEGER NOT NULL,
         csrf_token TEXT NOT NULL,
         created_at TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         idle_expires_at TEXT NOT NULL,
         absolute_expires_at TEXT NOT NULL,
         revoked_at TEXT
       )`,
      // V1 allows one active session, and login revokes the previous one. The
      // index supports that revoke-then-create step and the expiry sweep.
      `CREATE INDEX owner_sessions_active
         ON owner_sessions (revoked_at, absolute_expires_at)`,
    ],
  },
  {
    id: 3,
    name: "create_media_assets",
    statements: [
      // Media assets are immutable. "Replace this image" uploads a new row and
      // repoints the draft; the old row is left alone so that restoring an
      // older published revision still resolves to the image that revision was
      // published with. That is also why the provider must never overwrite a
      // public ID, and why a public ID is never reused even after deletion.
      //
      // `provider_asset_id` is the provider's own immutable identifier and is
      // what deletion is keyed on. `provider_public_id` appears in delivery
      // URLs. They are kept separate because a parsed delivery URL is not proof
      // of identity — only the asset id is.
      `CREATE TABLE media_assets (
         id TEXT PRIMARY KEY,
         provider TEXT NOT NULL CHECK (provider IN ('cloudinary')),
         provider_asset_id TEXT UNIQUE,
         provider_public_id TEXT NOT NULL UNIQUE,
         provider_version TEXT,
         format TEXT CHECK (format IN ('jpg', 'png', 'webp')),
         bytes INTEGER CHECK (bytes IS NULL OR bytes > 0),
         width INTEGER CHECK (width IS NULL OR width > 0),
         height INTEGER CHECK (height IS NULL OR height > 0),
         status TEXT NOT NULL
           CHECK (status IN (
             'uploading',
             'ready',
             'tombstoned',
             'delete_pending',
             'deleted',
             'failed'
           )),
         original_filename TEXT,
         alt_text TEXT,
         digest TEXT,
         created_at TEXT NOT NULL,
         tombstoned_at TEXT,
         deleted_at TEXT
       )`,
      // Provider metadata is absent while a row is `uploading` and required
      // once it is `ready`. Expressing that as a table constraint means a
      // half-finalized row cannot exist even if a future code path forgets a
      // field — the insert fails rather than producing an asset that renders
      // as a broken image.
      `CREATE TRIGGER media_assets_ready_requires_metadata
         BEFORE UPDATE OF status ON media_assets
         WHEN NEW.status = 'ready'
           AND (NEW.provider_asset_id IS NULL
             OR NEW.provider_version IS NULL
             OR NEW.format IS NULL
             OR NEW.bytes IS NULL
             OR NEW.width IS NULL
             OR NEW.height IS NULL)
         BEGIN
           SELECT RAISE(ABORT, 'ready media asset is missing provider metadata');
         END`,
      // The picker lists ready assets newest first; garbage collection scans by
      // status and age. One index serves both.
      `CREATE INDEX media_assets_status_created
         ON media_assets (status, created_at)`,
    ],
  },
  {
    id: 4,
    name: "create_content_items",
    statements: [
      // One table for every editable thing. The alternative — a table per type —
      // would duplicate identity, ordering, provenance, and the publication
      // pointer five times, and every query that spans types (the sitemap, the
      // import ledger, the reconciliation report) would become a union.
      //
      // The type-specific fields live in `data` as validated JSON. They are
      // never queried individually, only read whole and rendered, so columns
      // would buy nothing. What *is* queried — slug, ordering, publication date
      // — is a column precisely because it needs a constraint or an index.
      `CREATE TABLE content_items (
         id TEXT PRIMARY KEY,
         type TEXT NOT NULL
           CHECK (type IN ('home', 'about', 'branding', 'project', 'blog_post')),
         slug TEXT,
         schema_version INTEGER NOT NULL CHECK (schema_version > 0),
         data TEXT NOT NULL,
         display_order INTEGER,
         published_at TEXT,
         origin TEXT NOT NULL CHECK (origin IN ('import', 'owner')),
         owner_edited_at TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         -- Singletons have no public address of their own; collection items
         -- must have one. Expressed here so neither can be written the wrong
         -- way round by a code path that forgot.
         CHECK (
           (type IN ('home', 'about', 'branding') AND slug IS NULL)
           OR
           (type IN ('project', 'blog_post') AND slug IS NOT NULL)
         )
       )`,
      // Slugs are unique inside a collection, not across them: #32 permits a
      // Project and a Blog post to share one, and they live at different route
      // prefixes.
      `CREATE UNIQUE INDEX content_items_type_slug
         ON content_items (type, slug)
         WHERE slug IS NOT NULL`,
      // "There is exactly one Home." A partial unique index makes that a
      // storage guarantee rather than a convention the importer has to keep.
      `CREATE UNIQUE INDEX content_items_singleton
         ON content_items (type)
         WHERE type IN ('home', 'about', 'branding')`,
      // Projects are ordered by the Owner; Blog posts by publication date,
      // newest first.
      `CREATE INDEX content_items_type_order
         ON content_items (type, display_order)`,
      `CREATE INDEX content_items_type_published
         ON content_items (type, published_at DESC)`,
      // #32: singletons cannot be deleted, and an ID is never reused. Both are
      // identity rules, so they are enforced where identity lives rather than
      // in whichever code path happens to be doing the writing.
      `CREATE TRIGGER content_singletons_are_permanent
         BEFORE DELETE ON content_items
         WHEN OLD.type IN ('home', 'about', 'branding')
         BEGIN
           SELECT RAISE(ABORT, 'singleton content cannot be deleted');
         END`,
      `CREATE TRIGGER content_identity_is_immutable
         BEFORE UPDATE ON content_items
         WHEN NEW.id <> OLD.id OR NEW.type <> OLD.type
         BEGIN
           SELECT RAISE(ABORT, 'content identity cannot change');
         END`,
    ],
  },
  {
    id: 5,
    name: "create_import_ledger",
    statements: [
      // What was imported, from what, by which importer. #36 requires source
      // key, source hash, importer version, resulting entity ID, and
      // reconciliation totals to be recorded — this is the row that makes a
      // completed import auditable after the fact, when the repository files it
      // read may already have moved on.
      `CREATE TABLE import_runs (
         id TEXT PRIMARY KEY,
         importer_version INTEGER NOT NULL,
         source_fingerprint TEXT NOT NULL,
         mode TEXT NOT NULL CHECK (mode IN ('rehearsal', 'production')),
         entities_created INTEGER NOT NULL,
         entities_replaced INTEGER NOT NULL,
         entities_unchanged INTEGER NOT NULL,
         media_resolved INTEGER NOT NULL,
         views_imported INTEGER NOT NULL,
         view_total INTEGER NOT NULL,
         started_at TEXT NOT NULL,
         completed_at TEXT NOT NULL
       )`,
      // One row per imported entity, so a later question — "where did this
      // Project come from, and has the file changed since?" — is answerable
      // without re-deriving anything.
      `CREATE TABLE import_entities (
         run_id TEXT NOT NULL REFERENCES import_runs(id),
         content_id TEXT NOT NULL,
         source_key TEXT NOT NULL,
         source_hash TEXT NOT NULL,
         outcome TEXT NOT NULL
           CHECK (outcome IN ('created', 'replaced', 'unchanged')),
         PRIMARY KEY (run_id, content_id)
       )`,
      // Views are keyed by immutable content ID, not by slug: #36 requires the
      // count to survive a later slug change, which keying by slug would not.
      `CREATE TABLE content_view_counts (
         content_id TEXT PRIMARY KEY
           REFERENCES content_items(id),
         views INTEGER NOT NULL CHECK (views >= 0),
         imported_from_slug TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX import_entities_content ON import_entities (content_id)`,
    ],
  },
  {
    id: 6,
    name: "index_media_digest",
    statements: [
      // The digest column has existed since migration 3, but nothing looked
      // assets up by it until the importer started adopting images by content
      // hash. Deduplication now runs once per image on every import, so the
      // lookup gets an index.
      //
      // Deliberately not a UNIQUE constraint. A failed upload leaves a row
      // holding the digest of bytes the provider never accepted, and a retry of
      // those same bytes must be able to claim a fresh row rather than collide
      // with the corpse of the previous attempt. Uniqueness of *usable* assets
      // is enforced by the query, which only ever considers `ready` rows.
      `CREATE INDEX media_assets_digest ON media_assets (digest, status)`,
    ],
  },
  {
    id: 7,
    name: "tombstone_collection_content",
    statements: [
      // Collection deletion removes an item from the current draft without
      // erasing its identity. Published revisions, import history, view counts,
      // and former Public routes can therefore keep referring to the same row.
      `ALTER TABLE content_items ADD COLUMN deleted_at TEXT`,
      `CREATE INDEX content_items_active_type
         ON content_items (type, deleted_at)`,
      // Singletons are permanent whether a caller tries a physical DELETE or
      // the application-level tombstone used for collection items.
      `CREATE TRIGGER content_singletons_cannot_be_tombstoned
         BEFORE UPDATE OF deleted_at ON content_items
         WHEN OLD.type IN ('home', 'about', 'branding')
           AND NEW.deleted_at IS NOT NULL
         BEGIN
           SELECT RAISE(ABORT, 'singleton content cannot be deleted');
         END`,
    ],
  },
];
