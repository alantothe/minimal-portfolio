# Recovery operations

This runbook implements the recovery decision in issue #35 and Slice 9 in
issue #46. Public traffic remains on legacy content until Slice 10.

## Recovery layers

1. Railway volume snapshots: enable daily, weekly, and monthly schedules in the
   production volume's **Backups** tab. Take a locked manual snapshot before a
   migration or bulk import.
2. Private Cloudflare R2 bucket: application-consistent SQLite bundles and
   original Media assets are encrypted with `age` before upload.
3. Cloudinary: enable automatic backup in product-environment settings and run
   **Back Up Existing Assets** once. New application uploads also request
   `backup=true` per asset.

Do not point Cloudinary's managed external backup at the application recovery
bucket. Cloudinary owns that structure; this application owns its R2 keys and
retention.

## One-time R2 setup

Create one private Standard bucket named `minimal-portfolio-recovery`. Create a
bucket-scoped Object Read & Write S3 token for the Railway runtime. Keep bucket
administration and read-only recovery credentials separate from that token.

Configure lifecycle expiry only after matching object locks exist:

| Prefix            |        Object lock |                   Lifecycle expiry |
| ----------------- | -----------------: | ---------------------------------: |
| `db/hourly/`      |           48 hours |                           48 hours |
| `db/daily/`       |            35 days |                            35 days |
| `db/monthly/`     |          12 months |                          12 months |
| `db/pre-change/`  |            90 days |                            90 days |
| `media/original/` | at least 12 months | none; reference-aware cleanup only |

Objects use unique keys and conditional creation. Never overwrite a recovery
object.

Generate two independent identities on an offline machine:

```bash
age-keygen -o owner-recovery.identity
age-keygen -o drill-recovery.identity
age-keygen -y owner-recovery.identity
age-keygen -y drill-recovery.identity
```

Store identities outside Railway and R2. Railway receives public recipients
only.

Set these sealed Railway variables:

```text
RECOVERY_R2_ACCOUNT_ID
RECOVERY_R2_BUCKET
RECOVERY_R2_ACCESS_KEY_ID
RECOVERY_R2_SECRET_ACCESS_KEY
RECOVERY_AGE_OWNER_RECIPIENT
RECOVERY_AGE_DRILL_RECIPIENT
```

`RECOVERY_STAGING_ROOT` is optional and defaults beside the content database.
A partial configuration is fatal; a fully absent configuration is reported as
`recovery_unconfigured` without changing Visitor behavior.

## Normal operation

The running process serializes checkpoints and creates:

- hourly points, including an overdue startup point;
- daily and monthly points at UTC boundaries;
- a point within five minutes after successful Publication;
- encrypted, verified original copies after each Media upload.

Each database checkpoint uses `VACUUM INTO`, validates SQLite integrity,
foreign keys, migration checksums, Published-revision pointers and checksums,
routes, Media references, and Blog-view counts, then uploads DB + manifest as
one `.tar.age` object. R2 `HEAD` must confirm byte length and SHA-256 metadata
before success is recorded.

Check safe operational state:

```bash
bun run recovery:status
```

Public `/readyz` reports stable alert codes and counts, never object keys,
content, paths, identities, or credentials. Recovery alerts do not gate
readiness during the dark pre-cutover slices.

## Manual checkpoint

Run inside the production service before any migration, import, or risky bulk
operation, after taking the Railway manual snapshot:

```bash
bun run recovery:checkpoint
```

The command prints object key, digest, publication generation, and Published
fingerprint. Record those non-secret values in the change log. Stop if the
command exits non-zero.

## Isolated portable restore

Never restore over the live database as a test. Use read-only R2 credentials,
an approved identity file, and a new absolute target path in a disposable
environment:

```bash
bun scripts/recovery.ts drill-latest \
  --target /tmp/portfolio-drill/content.sqlite \
  --identity /secure/drill-recovery.identity
```

The command selects the newest hourly/daily object, verifies its encrypted
digest, decrypts and safely unpacks two allowlisted files, validates the
manifest and database semantics, deletes sessions and OAuth attempts, and
atomically installs the isolated target. Success records generation,
fingerprint, Media-reference count, and timing without exposing content.

For a selected object, use `restore --object <key>`. Add `--operator` only for
the quarterly operator drill record.

## Railway restore

1. Disable Owner-workspace writes and capture incident time, app commit, and
   generation.
2. Confirm an independent R2 bundle exists before changing Railway snapshots.
3. Stage the chosen snapshot in Railway, review the dated replacement volume,
   then deploy it.
4. Keep writes disabled. Verify DB integrity, routes, Media inventory, public
   output, redirects, sitemap, view totals, and draft isolation.
5. Invalidate sessions/OAuth state, require fresh sign-in, then re-enable
   writes and create a new verified R2 checkpoint.

Keep the old unmounted volume until recovery is accepted.

## Alert response

- `backup_failed`: inspect R2 reachability, `age`, staging space, then run a
  manual checkpoint.
- `backup_overdue`: newest successful point is older than one hour, or a
  failed backup has left Publication unprotected for more than five minutes;
  run a checkpoint and verify scheduling.
- `media_original_overdue`: at least one ready Media asset lacks a verified R2
  original after one hour; reconcile it before cutover.
- `restore_drill_failed`: preserve the selected object and investigate in an
  isolated environment.
- `restore_drill_overdue`: no successful drill in eight days; run
  `drill-latest`.

Quarterly, restore both Railway and portable paths in a disposable Railway
environment, restore one deleted Media asset into a non-production Cloudinary
folder/environment, record measured RPO/RTO and corrective actions, then
destroy the disposable environment.
