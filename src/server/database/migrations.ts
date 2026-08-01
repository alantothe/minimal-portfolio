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
];
