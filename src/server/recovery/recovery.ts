import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { MIGRATIONS } from "../database/migrations";
import { checksumOf } from "../database/migrator";
import { MediaRepository, type MediaAsset } from "../database/mediaRepository";

export type BackupKind =
  "hourly" | "daily" | "monthly" | "pre-change" | "manual";

export interface RecoveryObject {
  key: string;
  body: Uint8Array;
  bytes?: number;
  metadata: Record<string, string>;
}

export interface RecoveryObjectStore {
  put(object: RecoveryObject): Promise<void>;
  head(key: string): Promise<Omit<RecoveryObject, "body"> | null>;
  get(key: string): Promise<RecoveryObject | null>;
  list(prefix: string): Promise<string[]>;
}

export interface RecoveryCipher {
  encrypt(input: string, output: string, recipients: string[]): Promise<void>;
  decrypt(input: string, output: string, identityFile: string): Promise<void>;
}

export interface MediaOriginalSource {
  download(asset: MediaAsset): Promise<{
    bytes: Uint8Array;
    format: "jpg" | "png" | "webp";
  }>;
}

export interface RecoveryManifest {
  version: 1;
  createdAt: string;
  appCommit: string;
  schemaVersion: number;
  publicationGeneration: number;
  publishedFingerprint: string;
  databaseBytes: number;
  databaseDigest: string;
  tableRows: Record<string, number>;
  publicRoutes: string[];
  mediaReferences: string[];
  mediaInventory: Array<{
    id: string;
    providerAssetId: string;
    providerPublicId: string;
    providerVersion: string;
    digest: string | null;
  }>;
}

export interface BackupResult {
  objectKey: string;
  bundleDigest: string;
  publicationGeneration: number;
  publishedFingerprint: string;
  mediaReferences: string[];
  createdAt: string;
}

export interface RestoreResult {
  objectKey: string;
  publicationGeneration: number;
  publishedFingerprint: string;
  mediaReferences: string[];
  sessionsInvalidated: true;
  invalidatedSessions: number;
  invalidatedOauthAttempts: number;
  restoredAt: string;
}

export interface MediaProtectionResult {
  objectKey: string;
  bundleDigest: string;
  verifiedAt: string;
}

export type RecoveryAlert =
  | "backup_failed"
  | "backup_overdue"
  | "restore_drill_failed"
  | "restore_drill_overdue"
  | "media_original_overdue";

export interface RecoveryStatus {
  running: boolean;
  queued: number;
  lastSuccessfulBackupAt: string | null;
  lastSuccessfulDrillAt: string | null;
  unprotectedMediaIds: string[];
  alerts: RecoveryAlert[];
}

interface RecoveryDependencies {
  database: Database;
  databaseFile: string;
  stagingRoot: string;
  store: RecoveryObjectStore;
  cipher: RecoveryCipher;
  recipients: string[];
  appCommit: string;
  clock?: () => Date;
}

interface Validation {
  schemaVersion: number;
  publicationGeneration: number;
  publishedFingerprint: string;
  tableRows: Record<string, number>;
  publicRoutes: string[];
  mediaReferences: string[];
  mediaInventory: RecoveryManifest["mediaInventory"];
}

interface OperationRow {
  status: "succeeded" | "failed";
  completed_at: string;
}

const BUNDLE_DATABASE = "content.sqlite";
const BUNDLE_MANIFEST = "manifest.json";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sqlValue(database: Database, sql: string): unknown {
  const row = database.query(sql).get() as Record<string, unknown> | null;
  return row ? Object.values(row)[0] : undefined;
}

function collectMediaReferences(value: unknown, references: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/media:([0-9a-zA-Z-]{8,})/g)) {
      references.add(match[1]!);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectMediaReferences(entry, references));
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (typeof record.mediaAssetId === "string" && record.mediaAssetId !== "") {
    references.add(record.mediaAssetId);
  }
  Object.values(record).forEach((entry) =>
    collectMediaReferences(entry, references)
  );
}

function parseStoredJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateDatabase(file: string): Validation {
  const database = new Database(file, { readonly: true, strict: true });
  try {
    const integrity = database.query("PRAGMA integrity_check").all() as Array<
      Record<string, string>
    >;
    if (
      integrity.length !== 1 ||
      Object.values(integrity[0] ?? {})[0] !== "ok"
    ) {
      throw new Error("database integrity check failed");
    }
    const foreignKeys = database.query("PRAGMA foreign_key_check").all();
    if (foreignKeys.length !== 0) {
      throw new Error("database foreign key check failed");
    }

    const schemaVersion = Number(
      sqlValue(database, "SELECT COALESCE(MAX(id), 0) FROM schema_migrations")
    );
    const latestSchema = MIGRATIONS.at(-1)?.id ?? 0;
    if (schemaVersion !== latestSchema) {
      throw new Error(
        `database schema ${schemaVersion} is not supported by this release (${latestSchema})`
      );
    }
    const appliedMigrations = database
      .query("SELECT id, checksum FROM schema_migrations ORDER BY id")
      .all() as Array<{ id: number; checksum: string }>;
    if (
      appliedMigrations.length !== MIGRATIONS.length ||
      appliedMigrations.some(
        (applied, index) =>
          applied.id !== MIGRATIONS[index]?.id ||
          applied.checksum !== checksumOf(MIGRATIONS[index]!)
      )
    ) {
      throw new Error("database migration ledger does not match this release");
    }

    const brokenPointers = Number(
      sqlValue(
        database,
        `SELECT COUNT(*) FROM content_items content
          LEFT JOIN published_revisions revision
            ON revision.id = content.current_published_revision_id
         WHERE content.current_published_revision_id IS NOT NULL
           AND (revision.id IS NULL OR revision.content_id <> content.id)`
      )
    );
    if (brokenPointers !== 0) {
      throw new Error("current Published-revision pointer does not resolve");
    }

    const revisions = database
      .query(
        `SELECT id, content_id, snapshot, checksum
           FROM published_revisions ORDER BY content_id, revision_number`
      )
      .all() as Array<{
      id: string;
      content_id: string;
      snapshot: string;
      checksum: string;
    }>;
    const references = new Set<string>();
    for (const revision of revisions) {
      const snapshot = parseStoredJson(
        revision.snapshot,
        `Published revision ${revision.id}`
      );
      if (
        sha256(new TextEncoder().encode(stableJson(snapshot))) !==
        revision.checksum
      ) {
        throw new Error(
          `Published revision ${revision.id} checksum does not match`
        );
      }
      collectMediaReferences(snapshot, references);
    }
    const drafts = database
      .query("SELECT id, data FROM content_items")
      .all() as Array<{
      id: string;
      data: string;
    }>;
    for (const draft of drafts) {
      collectMediaReferences(
        parseStoredJson(draft.data, `Content draft ${draft.id}`),
        references
      );
    }

    const mediaInventory = (
      database
        .query(
          `SELECT id, provider_asset_id, provider_public_id, provider_version, digest
             FROM media_assets WHERE status = 'ready' ORDER BY id`
        )
        .all() as Array<{
        id: string;
        provider_asset_id: string;
        provider_public_id: string;
        provider_version: string;
        digest: string | null;
      }>
    ).map((row) => ({
      id: row.id,
      providerAssetId: row.provider_asset_id,
      providerPublicId: row.provider_public_id,
      providerVersion: row.provider_version,
      digest: row.digest,
    }));
    const knownMedia = new Set(mediaInventory.map((asset) => asset.id));
    const missingMedia = [...references].filter((id) => !knownMedia.has(id));
    if (missingMedia.length > 0) {
      throw new Error(
        `Media reference does not resolve: ${missingMedia.sort().join(", ")}`
      );
    }

    const invalidViews = Number(
      sqlValue(
        database,
        "SELECT COUNT(*) FROM content_view_counts WHERE views < 0 OR typeof(views) <> 'integer'"
      )
    );
    if (invalidViews !== 0) throw new Error("Blog-view count is invalid");

    const routeRows = database
      .query(
        `SELECT route, content_id, is_current
           FROM published_routes ORDER BY route`
      )
      .all() as Array<{
      route: string;
      content_id: string;
      is_current: number;
    }>;
    const seenRoutes = new Set<string>();
    const currentByContent = new Map<string, string>();
    const redirectTo = new Map<string, string>();
    for (const row of routeRows) {
      if (seenRoutes.has(row.route)) {
        throw new Error(`duplicate Public route ${row.route}`);
      }
      seenRoutes.add(row.route);
      if (row.is_current === 1) {
        if (currentByContent.has(row.content_id)) {
          throw new Error(
            `content ${row.content_id} has more than one current Public route`
          );
        }
        currentByContent.set(row.content_id, row.route);
      }
    }
    for (const row of routeRows) {
      if (row.is_current !== 0) continue;
      const destination = currentByContent.get(row.content_id);
      if (!destination) {
        throw new Error(
          `Public-route redirect ${row.route} has no destination`
        );
      }
      redirectTo.set(row.route, destination);
    }
    for (const [start, first] of redirectTo) {
      const seen = new Set<string>([start]);
      let current = first;
      while (redirectTo.has(current)) {
        if (seen.has(current)) {
          throw new Error(`Public-route redirect ${start} loops`);
        }
        seen.add(current);
        current = redirectTo.get(current)!;
      }
    }

    const tableNames = (
      database
        .query(
          `SELECT name FROM sqlite_schema
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    const tableRows: Record<string, number> = {};
    for (const table of tableNames) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("unexpected table name");
      tableRows[table] = Number(
        sqlValue(database, `SELECT COUNT(*) FROM ${table}`)
      );
    }

    const currentRevisions = database
      .query(
        `SELECT content.id, content.current_published_revision_id AS revision_id,
                revision.checksum
           FROM content_items content
           JOIN published_revisions revision
             ON revision.id = content.current_published_revision_id
          ORDER BY content.id`
      )
      .all();
    const publicationGeneration = Number(
      sqlValue(
        database,
        "SELECT site_generation FROM publication_state WHERE id = 1"
      )
    );
    const publicRoutes = routeRows.map((row) => row.route);
    const mediaReferences = [...references].sort();
    const publishedFingerprint = sha256(
      new TextEncoder().encode(
        stableJson({
          publicationGeneration,
          currentRevisions,
          routeRows,
          mediaInventory: mediaInventory.filter((asset) =>
            references.has(asset.id)
          ),
        })
      )
    );

    return {
      schemaVersion,
      publicationGeneration,
      publishedFingerprint,
      tableRows,
      publicRoutes,
      mediaReferences,
      mediaInventory,
    };
  } finally {
    database.close();
  }
}

async function run(command: string[], cwd?: string): Promise<string> {
  const process = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command[0]} failed (${exitCode}): ${stderr.trim() || "no error detail"}`
    );
  }
  return stdout;
}

async function pack(directory: string, output: string): Promise<void> {
  await run(
    ["tar", "-cf", output, BUNDLE_DATABASE, BUNDLE_MANIFEST],
    directory
  );
}

async function unpack(archive: string, directory: string): Promise<void> {
  const listed = (await run(["tar", "-tf", archive]))
    .split("\n")
    .filter(Boolean)
    .sort();
  if (
    listed.length !== 2 ||
    listed[0] !== BUNDLE_DATABASE ||
    listed[1] !== BUNDLE_MANIFEST
  ) {
    throw new Error("backup archive contains unexpected paths");
  }
  await run(["tar", "-xf", archive, "-C", directory]);
}

function sanitizeChangeId(changeId: string): string {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(changeId)) {
    throw new Error("pre-change id must be a short filesystem-safe token");
  }
  return changeId;
}

function objectKey(
  kind: BackupKind,
  at: Date,
  generation: number,
  nonce: string,
  changeId = "manual"
): string {
  const iso = at.toISOString();
  const day = iso.slice(0, 10).replaceAll("-", "/");
  const month = day.slice(0, 7);
  const timestamp = iso.replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  if (kind === "monthly") {
    return `db/monthly/${month}/${timestamp}-${generation}-${nonce}.tar.age`;
  }
  if (kind === "pre-change" || kind === "manual") {
    return `db/pre-change/${day}/${sanitizeChangeId(changeId)}-${generation}-${nonce}.tar.age`;
  }
  return `db/${kind}/${day}/${timestamp}-${generation}-${nonce}.tar.age`;
}

async function verifyUploadedObject(
  store: RecoveryObjectStore,
  key: string,
  body: Uint8Array,
  digest: string,
  message: string
): Promise<void> {
  const head = await store.head(key);
  if (
    !head ||
    head.bytes !== body.byteLength ||
    head.metadata.sha256 !== digest
  ) {
    throw new Error(message);
  }
}

async function ensureMissing(file: string): Promise<void> {
  try {
    await access(file);
  } catch {
    return;
  }
  throw new Error(`restore target already exists: ${file}`);
}

export class RecoveryCoordinator {
  private readonly clock: () => Date;
  private tail: Promise<unknown> = Promise.resolve();
  private running = false;
  private queued = 0;

  constructor(private readonly dependencies: RecoveryDependencies) {
    if (dependencies.recipients.length < 2) {
      throw new Error(
        "recovery encryption requires owner and drill recipients"
      );
    }
    this.clock = dependencies.clock ?? (() => new Date());
  }

  status(): RecoveryStatus {
    const backup = this.dependencies.database
      .query(
        `SELECT status, completed_at FROM recovery_operations
          ORDER BY datetime(completed_at) DESC, rowid DESC LIMIT 1`
      )
      .get() as OperationRow | null;
    const successfulBackup = this.dependencies.database
      .query(
        `SELECT completed_at FROM recovery_operations
          WHERE status = 'succeeded'
          ORDER BY datetime(completed_at) DESC, rowid DESC LIMIT 1`
      )
      .get() as { completed_at: string } | null;
    const drill = this.dependencies.database
      .query(
        `SELECT status, completed_at FROM recovery_drills
          ORDER BY datetime(completed_at) DESC, rowid DESC LIMIT 1`
      )
      .get() as OperationRow | null;
    const successfulDrill = this.dependencies.database
      .query(
        `SELECT completed_at FROM recovery_drills
          WHERE status = 'succeeded'
          ORDER BY datetime(completed_at) DESC, rowid DESC LIMIT 1`
      )
      .get() as { completed_at: string } | null;
    const now = this.clock().getTime();
    const hourAgo = now - 60 * 60 * 1_000;
    const publicationRpoAgo = now - 5 * 60 * 1_000;
    const unprotectedMediaIds = (
      this.dependencies.database
        .query(
          `SELECT id, created_at FROM media_assets
            WHERE status = 'ready' AND recovery_backed_up_at IS NULL
            ORDER BY id`
        )
        .all() as Array<{ id: string; created_at: string }>
    )
      .filter((row) => Date.parse(row.created_at) <= hourAgo)
      .map((row) => row.id);
    const alerts: RecoveryAlert[] = [];
    if (backup?.status === "failed") alerts.push("backup_failed");
    const lastSuccessAt = successfulBackup
      ? Date.parse(successfulBackup.completed_at)
      : null;
    const hourlyOverdue = lastSuccessAt === null || lastSuccessAt <= hourAgo;
    const publicationOverdue =
      backup?.status === "failed" &&
      (lastSuccessAt === null || lastSuccessAt <= publicationRpoAgo);
    if (hourlyOverdue || publicationOverdue) {
      alerts.push("backup_overdue");
    }
    if (drill?.status === "failed") alerts.push("restore_drill_failed");
    if (
      !successfulDrill ||
      Date.parse(successfulDrill.completed_at) <= now - 8 * 24 * 60 * 60 * 1_000
    ) {
      alerts.push("restore_drill_overdue");
    }
    if (unprotectedMediaIds.length > 0) {
      alerts.push("media_original_overdue");
    }
    return {
      running: this.running,
      queued: this.queued,
      lastSuccessfulBackupAt: successfulBackup?.completed_at ?? null,
      lastSuccessfulDrillAt: successfulDrill?.completed_at ?? null,
      unprotectedMediaIds,
      alerts,
    };
  }

  async latestPortableBackupKey(): Promise<string | null> {
    const keys = (
      await Promise.all([
        this.dependencies.store.list("db/hourly/"),
        this.dependencies.store.list("db/daily/"),
      ])
    ).flat();
    keys.sort((left, right) => {
      const leftName = left.slice(left.lastIndexOf("/") + 1);
      const rightName = right.slice(right.lastIndexOf("/") + 1);
      return rightName.localeCompare(leftName) || right.localeCompare(left);
    });
    return keys[0] ?? null;
  }

  checkpoint(
    kind: BackupKind,
    options: { changeId?: string } = {}
  ): Promise<BackupResult> {
    this.queued += 1;
    const operation = this.tail.then(async () => {
      this.queued -= 1;
      this.running = true;
      const startedAt = this.clock().toISOString();
      try {
        const result = await this.createCheckpoint(kind, options.changeId);
        this.recordBackup({
          kind,
          status: "succeeded",
          startedAt,
          completedAt: this.clock().toISOString(),
          result,
        });
        return result;
      } catch (error) {
        this.recordBackup({
          kind,
          status: "failed",
          startedAt,
          completedAt: this.clock().toISOString(),
        });
        throw error;
      } finally {
        this.running = false;
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  private recordBackup(
    input:
      | {
          kind: BackupKind;
          status: "succeeded";
          startedAt: string;
          completedAt: string;
          result: BackupResult;
        }
      | {
          kind: BackupKind;
          status: "failed";
          startedAt: string;
          completedAt: string;
        }
  ): void {
    this.dependencies.database
      .query(
        `INSERT INTO recovery_operations (
           id, kind, status, started_at, completed_at, object_key,
           bundle_digest, publication_generation, error_code
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomBytes(16).toString("hex"),
        input.kind,
        input.status,
        input.startedAt,
        input.completedAt,
        input.status === "succeeded" ? input.result.objectKey : null,
        input.status === "succeeded" ? input.result.bundleDigest : null,
        input.status === "succeeded"
          ? input.result.publicationGeneration
          : null,
        input.status === "failed" ? "backup_failed" : null
      );
  }

  private async createCheckpoint(
    kind: BackupKind,
    changeId?: string
  ): Promise<BackupResult> {
    const at = this.clock();
    await mkdir(this.dependencies.stagingRoot, { recursive: true });
    const [source, filesystem] = await Promise.all([
      stat(this.dependencies.databaseFile),
      statfs(this.dependencies.stagingRoot),
    ]);
    const requiredBytes = Math.max(source.size * 2, 1024 * 1024);
    const availableBytes = filesystem.bavail * filesystem.bsize;
    if (availableBytes < requiredBytes) {
      throw new Error("insufficient staging space for consistent backup");
    }
    const directory = await mkdtemp(join(this.dependencies.stagingRoot, "db-"));
    try {
      const databaseFile = join(directory, BUNDLE_DATABASE);
      this.dependencies.database.query("VACUUM INTO ?").run(databaseFile);
      const validation = validateDatabase(databaseFile);
      const databaseBytes = await readFile(databaseFile);
      const manifest: RecoveryManifest = {
        version: 1,
        createdAt: at.toISOString(),
        appCommit: this.dependencies.appCommit,
        schemaVersion: validation.schemaVersion,
        publicationGeneration: validation.publicationGeneration,
        publishedFingerprint: validation.publishedFingerprint,
        databaseBytes: databaseBytes.byteLength,
        databaseDigest: sha256(databaseBytes),
        tableRows: validation.tableRows,
        publicRoutes: validation.publicRoutes,
        mediaReferences: validation.mediaReferences,
        mediaInventory: validation.mediaInventory,
      };
      await writeFile(
        join(directory, BUNDLE_MANIFEST),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { mode: 0o600 }
      );
      const archive = join(directory, "backup.tar");
      const encrypted = `${archive}.age`;
      await pack(directory, archive);
      await this.dependencies.cipher.encrypt(
        archive,
        encrypted,
        this.dependencies.recipients
      );
      const body = await readFile(encrypted);
      const bundleDigest = sha256(body);
      const key = objectKey(
        kind,
        at,
        validation.publicationGeneration,
        randomBytes(6).toString("hex"),
        changeId ??
          (kind === "manual" || kind === "pre-change" ? kind : "manual")
      );
      await this.dependencies.store.put({
        key,
        body,
        metadata: {
          sha256: bundleDigest,
          generation: String(validation.publicationGeneration),
          schema: String(validation.schemaVersion),
        },
      });
      await verifyUploadedObject(
        this.dependencies.store,
        key,
        body,
        bundleDigest,
        "uploaded backup did not pass object verification"
      );
      return {
        objectKey: key,
        bundleDigest,
        publicationGeneration: validation.publicationGeneration,
        publishedFingerprint: validation.publishedFingerprint,
        mediaReferences: validation.mediaReferences,
        createdAt: manifest.createdAt,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async restore(input: {
    objectKey: string;
    targetDatabaseFile: string;
    identityFile: string;
    drillKind?: "automated" | "operator";
  }): Promise<RestoreResult> {
    const startedAt = this.clock().toISOString();
    try {
      const result = await this.restoreVerified(input);
      this.recordDrill({
        kind: input.drillKind ?? "automated",
        status: "succeeded",
        objectKey: input.objectKey,
        startedAt,
        completedAt: this.clock().toISOString(),
        result,
      });
      return result;
    } catch (error) {
      this.recordDrill({
        kind: input.drillKind ?? "automated",
        status: "failed",
        objectKey: input.objectKey,
        startedAt,
        completedAt: this.clock().toISOString(),
      });
      throw error;
    }
  }

  private recordDrill(
    input:
      | {
          kind: "automated" | "operator";
          status: "succeeded";
          objectKey: string;
          startedAt: string;
          completedAt: string;
          result: RestoreResult;
        }
      | {
          kind: "automated" | "operator";
          status: "failed";
          objectKey: string;
          startedAt: string;
          completedAt: string;
        }
  ): void {
    this.dependencies.database
      .query(
        `INSERT INTO recovery_drills (
           id, kind, status, object_key, publication_generation,
           published_fingerprint, started_at, completed_at, error_code
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomBytes(16).toString("hex"),
        input.kind,
        input.status,
        input.objectKey,
        input.status === "succeeded"
          ? input.result.publicationGeneration
          : null,
        input.status === "succeeded" ? input.result.publishedFingerprint : null,
        input.startedAt,
        input.completedAt,
        input.status === "failed" ? "restore_drill_failed" : null
      );
  }

  private async restoreVerified(input: {
    objectKey: string;
    targetDatabaseFile: string;
    identityFile: string;
  }): Promise<RestoreResult> {
    await ensureMissing(input.targetDatabaseFile);
    const object = await this.dependencies.store.get(input.objectKey);
    if (!object) throw new Error(`backup object not found: ${input.objectKey}`);
    if (sha256(object.body) !== object.metadata.sha256) {
      throw new Error("encrypted object digest does not match metadata");
    }

    await mkdir(this.dependencies.stagingRoot, { recursive: true });
    const directory = await mkdtemp(
      join(this.dependencies.stagingRoot, "restore-")
    );
    try {
      const encrypted = join(directory, "backup.tar.age");
      const archive = join(directory, "backup.tar");
      const unpacked = join(directory, "unpacked");
      await mkdir(unpacked, { mode: 0o700 });
      await writeFile(encrypted, object.body, { mode: 0o600 });
      await this.dependencies.cipher.decrypt(
        encrypted,
        archive,
        input.identityFile
      );
      await unpack(archive, unpacked);
      const bundledDatabase = join(unpacked, BUNDLE_DATABASE);
      const manifest = JSON.parse(
        await readFile(join(unpacked, BUNDLE_MANIFEST), "utf8")
      ) as RecoveryManifest;
      if (manifest.version !== 1)
        throw new Error("unsupported backup manifest");
      const databaseBytes = await readFile(bundledDatabase);
      if (sha256(databaseBytes) !== manifest.databaseDigest) {
        throw new Error("restored database digest does not match manifest");
      }
      const before = validateDatabase(bundledDatabase);
      if (
        before.publicationGeneration !== manifest.publicationGeneration ||
        before.publishedFingerprint !== manifest.publishedFingerprint ||
        JSON.stringify(before.mediaReferences) !==
          JSON.stringify(manifest.mediaReferences)
      ) {
        throw new Error("restored database does not match manifest semantics");
      }

      const sanitized = join(directory, "sanitized.sqlite");
      await copyFile(bundledDatabase, sanitized);
      const database = new Database(sanitized, { strict: true });
      let invalidatedSessions = 0;
      let invalidatedOauthAttempts = 0;
      try {
        database.exec("PRAGMA foreign_keys = ON");
        invalidatedSessions = Number(
          sqlValue(database, "SELECT COUNT(*) FROM owner_sessions")
        );
        invalidatedOauthAttempts = Number(
          sqlValue(database, "SELECT COUNT(*) FROM oauth_attempts")
        );
        database.transaction(() => {
          database.exec("DELETE FROM owner_sessions");
          database.exec("DELETE FROM oauth_attempts");
        })();
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        database.close();
      }
      const after = validateDatabase(sanitized);
      if (after.publishedFingerprint !== before.publishedFingerprint) {
        throw new Error("session invalidation changed published content");
      }
      await mkdir(dirname(input.targetDatabaseFile), { recursive: true });
      const pending = `${input.targetDatabaseFile}.restore-${randomBytes(4).toString("hex")}`;
      try {
        await copyFile(sanitized, pending);
        await rename(pending, input.targetDatabaseFile);
      } catch (error) {
        await rm(pending, { force: true });
        throw error;
      }

      return {
        objectKey: input.objectKey,
        publicationGeneration: after.publicationGeneration,
        publishedFingerprint: after.publishedFingerprint,
        mediaReferences: after.mediaReferences,
        sessionsInvalidated: true,
        invalidatedSessions,
        invalidatedOauthAttempts,
        restoredAt: this.clock().toISOString(),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async protectMediaOriginal(input: {
    mediaId: string;
    format: "jpg" | "png" | "webp";
    digest: string;
    bytes: Uint8Array;
  }): Promise<MediaProtectionResult> {
    if (sha256(input.bytes) !== input.digest) {
      throw new Error("Media original digest does not match bytes");
    }
    const asset = this.dependencies.database
      .query(
        `SELECT id, digest FROM media_assets
          WHERE id = ? AND status = 'ready'`
      )
      .get(input.mediaId) as { id: string; digest: string | null } | null;
    if (!asset || (asset.digest !== null && asset.digest !== input.digest)) {
      throw new Error("Media original does not match a ready Media asset");
    }
    await mkdir(this.dependencies.stagingRoot, { recursive: true });
    const directory = await mkdtemp(
      join(this.dependencies.stagingRoot, "media-")
    );
    try {
      const original = join(directory, `original.${input.format}`);
      const encrypted = `${original}.age`;
      await writeFile(original, input.bytes, { mode: 0o600 });
      await this.dependencies.cipher.encrypt(
        original,
        encrypted,
        this.dependencies.recipients
      );
      const body = await readFile(encrypted);
      const bundleDigest = sha256(body);
      const key = `media/original/${input.mediaId}/${input.digest}.${input.format}.age`;
      await this.dependencies.store.put({
        key,
        body,
        metadata: {
          sha256: bundleDigest,
          original_sha256: input.digest,
          media_id: input.mediaId,
        },
      });
      await verifyUploadedObject(
        this.dependencies.store,
        key,
        body,
        bundleDigest,
        "uploaded Media original did not pass object verification"
      );
      const result = {
        objectKey: key,
        bundleDigest,
        verifiedAt: this.clock().toISOString(),
      };
      this.dependencies.database
        .query(
          `UPDATE media_assets
              SET digest = COALESCE(digest, ?),
                  recovery_object_key = ?, recovery_backed_up_at = ?,
                  recovery_error_at = NULL, recovery_error_code = NULL
            WHERE id = ? AND status = 'ready'`
        )
        .run(input.digest, result.objectKey, result.verifiedAt, input.mediaId);
      return result;
    } catch (error) {
      this.dependencies.database
        .query(
          `UPDATE media_assets
              SET recovery_error_at = ?, recovery_error_code = 'media_backup_failed'
            WHERE id = ?`
        )
        .run(this.clock().toISOString(), input.mediaId);
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async reconcileMediaOriginals(
    source: MediaOriginalSource
  ): Promise<{ protected: number; failed: number }> {
    const ids = (
      this.dependencies.database
        .query(
          `SELECT id FROM media_assets
            WHERE status = 'ready' AND recovery_backed_up_at IS NULL
            ORDER BY id`
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
    const repository = new MediaRepository(this.dependencies.database);
    let protectedCount = 0;
    let failed = 0;
    for (const id of ids) {
      const asset = repository.findById(id);
      if (!asset) continue;
      try {
        const original = await source.download(asset);
        if (asset.format !== original.format) {
          throw new Error("Downloaded Media original format changed");
        }
        await this.protectMediaOriginal({
          mediaId: asset.id,
          format: original.format,
          digest: sha256(original.bytes),
          bytes: original.bytes,
        });
        protectedCount += 1;
      } catch {
        failed += 1;
        this.dependencies.database
          .query(
            `UPDATE media_assets
                SET recovery_error_at = ?,
                    recovery_error_code = 'media_reconciliation_failed'
              WHERE id = ?`
          )
          .run(this.clock().toISOString(), id);
      }
    }
    return { protected: protectedCount, failed };
  }
}
