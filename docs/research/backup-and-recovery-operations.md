# Backup and recovery operations

Research for [Define backup and recovery operations](https://github.com/alantothe/minimal-portfolio/issues/35), current through 2026-07-31.

## Decision

Use three independent recovery layers:

1. Railway volume snapshots for fast same-environment rollback.
2. Application-consistent, encrypted SQLite bundles in a private Cloudflare R2 bucket for portable off-Railway recovery.
3. Cloudinary automatic backup plus app-owned R2 copies of original Media assets for provider-independent media recovery.

Creating a backup is not enough. Every SQLite export is validated before upload, the uploaded object is checked, a clean-room restore runs weekly, and a full operator drill runs quarterly.

## Recovery objectives

| Data or capability                          | Recovery-point objective            | Recovery-time objective                                   |
| ------------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| Published content, revision history, routes | 5 minutes after Publication         | 2 hours from cold failure                                 |
| Content drafts, sessions, Blog views        | 1 hour                              | 2 hours from cold failure                                 |
| Original Media assets and provider mappings | 1 hour after upload                 | 8 hours for full provider-independent recovery            |
| Warm public site during SQLite failure      | Last activated published generation | Near-zero; serve the in-memory last-known-good generation |

These are V1 operational targets, not provider guarantees. Quarterly drills measure actual recovery time and tighten or relax targets from evidence.

## Primary-source findings

### Railway snapshots

Railway volume backups include SQLite and support simultaneous daily, weekly, and monthly schedules. Current fixed retention is:

- daily every 24 hours, kept 6 days;
- weekly every 7 days, kept 1 month;
- monthly every 30 days, kept 3 months.

Manual backups are also available. Restoring stages a dated replacement volume at the same mount, keeps the previous volume unmounted, and redeploys after operator confirmation. Restoring an older backup removes newer backups. Manual backups are limited when data exceeds half the volume capacity.

Railway snapshots are not portable disaster recovery: they restore only inside the same project and environment, and wiping a volume deletes its backups. Enable all three schedules, but keep an independent copy elsewhere.

Sources: [Railway volume backups](https://docs.railway.com/volumes/backups), [Railway volume reference](https://docs.railway.com/volumes/reference), [Railway volume API](https://docs.railway.com/integrations/api/manage-volumes).

### SQLite consistency and portability

SQLite WAL state may include committed transactions not yet copied into the main file. Separating a live database from its `-wal` file can lose committed data or corrupt the copy. Never use a raw copy of only `/data/content.sqlite` while the app is running.

SQLite provides two supported live-snapshot mechanisms:

- Online Backup API creates a consistent snapshot while other clients continue operating.
- `VACUUM INTO` creates a compact, transactionally consistent database copy and removes deleted-page remnants.

`bun:sqlite` can execute `VACUUM`, so V1 can use `VACUUM INTO` behind the application-owned database module. An interrupted export may be incomplete; completion alone is not proof. Open the result separately and require both `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. SQLite files are cross-platform and portable across supported SQLite implementations.

Sources: [SQLite Online Backup API](https://sqlite.org/backup.html), [SQLite `VACUUM INTO`](https://sqlite.org/lang_vacuum.html#vacuuminto), [SQLite WAL](https://sqlite.org/wal.html), [SQLite integrity pragmas](https://sqlite.org/pragma.html#pragma_integrity_check), [Bun SQLite API](https://bun.com/reference/bun/sqlite).

### Cloudinary recovery

Cloudinary automatic backup is off by default. When enabled, it saves originals in a secondary write-protected location and supports listing, downloading, and restoring previous or deleted versions. Existing assets need a one-time **Back Up Existing Assets** job. Derived transformations are not backed up because Cloudinary can regenerate them.

Cloudinary backup is recovery inside Cloudinary, not sufficient provider portability:

- recovery without previously enabled backup is case-by-case through Support;
- bulk-delete recovery requires Support;
- deleting a backed-up version is irreversible;
- Cloudinary-managed external backup storage uses a provider-owned structure that Cloudinary says not to rename, edit, version, lifecycle-manage, or object-lock.

Keep Cloudinary automatic backup, then also retain each immutable original and its metadata in app-owned R2 storage.

Sources: [Cloudinary backup and version management](https://cloudinary.com/documentation/backups_and_version_management), [Cloudinary Admin API](https://cloudinary.com/documentation/admin_api), [Cloudinary archive generation](https://cloudinary.com/documentation/generate_archives), [Cloudinary backup download API](https://cloudinary.com/documentation/image_upload_api_reference#download_backup).

### Off-platform object storage

Use a private Cloudflare R2 Standard bucket named for portfolio recovery. R2:

- supports S3-compatible uploads and downloads;
- encrypts objects and metadata at rest with AES-256 and uses TLS in transit;
- permits bucket-scoped object tokens;
- provides prefix-specific retention locks that prevent overwrite or deletion;
- provides lifecycle expiry rules;
- includes 10 GB-month Standard storage, one million Class A operations, and ten million Class B operations in its current monthly free tier.

R2 durability does not protect against intentional deletion by itself. Use unique, never-overwritten object keys, bucket locks, lifecycle rules, and least-privilege credentials.

Sources: [R2 S3 uploads](https://developers.cloudflare.com/r2/objects/upload-objects/), [R2 data security](https://developers.cloudflare.com/r2/reference/data-security/), [R2 durability](https://developers.cloudflare.com/r2/reference/durability/), [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/), [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), [R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## SQLite backup pipeline

One `BackupCoordinator` inside the Bun process owns scheduling and serialization. It runs:

- hourly;
- within 5 minutes after successful Publication;
- before every schema migration or bulk import;
- after every schema migration or bulk import;
- on startup when the last successful hourly backup is overdue;
- on an explicit authenticated operator command.

Publication does not wait for R2. A failed post-Publication backup raises an operational alert and remains retryable; it does not roll back already-published content.

For each run:

1. Allocate a unique staging path on `/data`; require enough free space for the export.
2. Run `VACUUM INTO` through the live app database connection. Never accept a user-controlled output path.
3. Open the exported database independently.
4. Require `PRAGMA integrity_check` to return one `ok` row.
5. Require `PRAGMA foreign_key_check` to return no rows.
6. Run semantic checks:
   - known schema/migration version;
   - each current Published-revision pointer resolves;
   - immutable revisions and Public-route uniqueness hold;
   - redirects resolve without loops;
   - every Media reference resolves to a Media record;
   - Blog-view counts are finite and non-negative.
7. Build a manifest containing UTC timestamp, app commit, schema version, publication generation, source database size, per-table row counts, selected public-route checks, Media inventory, and SHA-256 digest.
8. Package database and manifest, then encrypt to two `age` recipients: an offline Portfolio-owner recovery key and a separate automated-drill key. Railway stores public recipients only; private identities never live in Railway or R2.
9. Upload through a bucket-scoped R2 token under a unique key. Record SHA-256 as object metadata and verify the uploaded object with `HEAD`.
10. Record success in backup operations state, then delete local staging files.

`age` supports encrypting one file to multiple public recipients while either private identity can decrypt it. Source: [`age` project documentation](https://github.com/FiloSottile/age).

### R2 keys and retention

Use timestamped keys; never overwrite:

```text
db/hourly/2026/07/31/2026-07-31T18-00-00Z-<generation>.tar.age
db/daily/2026/07/31/2026-07-31T00-00-00Z-<generation>.tar.age
db/monthly/2026/07/2026-07-01T00-00-00Z-<generation>.tar.age
db/pre-change/2026/07/31/<change-id>-<generation>.tar.age
media/original/<media-id>/<sha256>.<format>.age
```

Retention:

| Prefix            | Keep                                                                                      | Lock                          |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| `db/hourly/`      | 48 hours                                                                                  | 48 hours                      |
| `db/daily/`       | 35 days                                                                                   | 35 days                       |
| `db/monthly/`     | 12 months                                                                                 | 12 months                     |
| `db/pre-change/`  | 90 days                                                                                   | 90 days                       |
| `media/original/` | While any draft or retained Published revision references asset, plus media cleanup delay | At least 12 months per object |

Lifecycle rules may expire database backups only after their matching lock. Media originals have no blind lifecycle expiry; reference-aware cleanup decides eligibility.

Use separate credentials:

- runtime writer: object read/write, scoped only to recovery bucket;
- automated drill: object read-only, stored outside Railway;
- human recovery: object read-only plus offline `age` identity;
- bucket-lock configuration: separate administrator credential, never available to runtime.

## Media backup pipeline

1. Enable Cloudinary automatic backup.
2. Run and verify **Back Up Existing Assets** before production cutover.
3. Every new upload creates a new immutable app Media ID, as already decided.
4. Queue its original bytes for `age` encryption and R2 upload under the Media ID and content digest.
5. Store Cloudinary immutable asset ID, public ID, version, original digest, R2 object key, and backup timestamp in SQLite.
6. Do not treat an upload as offsite-protected until R2 `HEAD` verification succeeds. Alert if protection is more than one hour late; do not block an otherwise valid Publication.
7. Reconcile SQLite, Cloudinary Admin API inventory, Cloudinary backup status, and R2 objects daily.
8. Back up originals only. Named Cloudinary variants remain reproducible implementation outputs.

The R2 Media archive is app-owned and portable. Do not point Cloudinary automatic backup at this same bucket: Cloudinary imposes incompatible storage-management restrictions on its managed external-backup structure.

## Recovery runbooks

### Fast Railway restore

Use when Railway project/environment still exists and a suitable native snapshot predates the incident.

1. Disable Owner-workspace writes. Warm public reads continue from last-known-good generation when possible.
2. Capture incident timestamp, active app commit, publication generation, and suspected cause.
3. Confirm an independent R2 backup exists before restoring; Railway warns that restoring an old snapshot removes newer native snapshots.
4. Select Railway snapshot by timestamp and stage restore.
5. Review staged volume change, then deploy it.
6. Start the compatible app commit against restored DB with writes still disabled.
7. Run integrity, foreign-key, semantic, route, Media-inventory, and public-render checks.
8. Delete all restored sessions and OAuth transient state. Require fresh owner sign-in.
9. Verify Home, About, every collection page, representative detail pages, redirects, sitemap, Blog-view totals, draft visibility, and latest Published revision.
10. Re-enable writes, trigger a new verified R2 backup, and record actual RPO/RTO.

Keep the unmounted previous volume until recovery is accepted and incident evidence is no longer needed.

### Portable SQLite restore

Use for lost/corrupt Railway project, unusable native snapshots, or portability drill.

1. Provision a fresh volume mounted at `/data`; keep app stopped.
2. Download chosen R2 object using read-only credentials.
3. Verify encrypted-object digest, decrypt with an approved `age` identity, and unpack into a temporary directory.
4. Verify manifest, `integrity_check`, `foreign_key_check`, semantic invariants, and expected app/schema compatibility.
5. Place verified file at `/data/content.sqlite` while no process has it open. Do not carry stale `-wal` or `-shm` files from another database.
6. Start the recorded compatible app version. Apply newer migrations only after taking another pre-change backup.
7. Invalidate sessions/OAuth state.
8. Complete public, redirect, sitemap, Blog-view, draft-isolation, and Media reconciliation checks.
9. Re-enable writes and create a fresh verified backup.

### Cloudinary asset restore

1. Resolve app Media ID to Cloudinary immutable asset ID and expected version.
2. Prefer Cloudinary Admin API restore from automatic backup.
3. Verify original digest and normal named variants.
4. If Cloudinary recovery is unavailable, decrypt the R2 original and upload it to the replacement provider/environment.
5. In one transaction, update only provider mapping for the same app Media ID. Published revisions keep their stable Media reference.
6. Rebuild and activate one complete Published-site generation, then verify every referencing revision.

Never rewrite historical revision payloads to new provider URLs.

## Verification and drills

### Every backup

- consistent SQLite-native export, not raw WAL copy;
- integrity, foreign-key, and semantic checks pass;
- encryption succeeds;
- uploaded object exists with expected size/digest metadata;
- backup completion and duration recorded;
- alert on failure or overdue RPO.

### Weekly automated clean-room restore

In isolated CI:

1. use read-only R2 credentials and separate drill `age` identity;
2. download newest hourly/daily bundle;
3. decrypt into a temporary directory;
4. open with current compatible code and an in-memory/test server;
5. run DB and public-generation invariants;
6. delete decrypted files;
7. publish only pass/fail, generation, age, and duration—never content or secrets.

Alert when last successful drill is older than 8 days.

### Quarterly operator drill

Restore into a disposable Railway environment and non-production Cloudinary environment/folder. Exercise both a Railway snapshot and the portable R2 path, restore at least one deleted Media asset, verify public output, measure RPO/RTO, then destroy the disposable environment.

The drill is incomplete until a written record includes selected backup, checks, timing, failures, corrective actions, and next drill date.

## Required implementation/config checklist

- Railway daily + weekly + monthly schedules enabled.
- Manual locked Railway backup before migration/import.
- Private R2 Standard bucket.
- Prefix locks and lifecycle rules configured.
- Runtime bucket-scoped token sealed in Railway.
- Read-only recovery credentials stored outside Railway.
- Offline owner and isolated drill `age` identities tested.
- Cloudinary automatic backup enabled.
- Existing Cloudinary assets backup job completed.
- BackupCoordinator serialized, retryable, observable.
- `VACUUM INTO`, integrity, foreign-key, and semantic verification implemented.
- R2 original-Media copy and daily reconciliation implemented.
- Session invalidation included in every DB restore.
- Weekly clean-room and quarterly full drills scheduled.
- Alerts for backup age, failed validation/upload, missing Media copies, disabled Cloudinary backup, and overdue drills.

## Why not rely on one layer

- Railway snapshots are fast but share Railway project/environment fate and have short fixed retention.
- R2 database bundles are portable but do not restore Cloudinary originals by themselves.
- Cloudinary backup restores assets but not SQLite identities, references, drafts, redirects, or Blog views.
- A raw SQLite file copy can omit WAL commits.
- An untested backup proves storage, not recoverability.

Together, native snapshots, encrypted portable bundles, independent Media originals, and recurring drills cover operator error, volume loss, provider loss, corruption, and migration rollback without putting Git or deployment back into Publication.
