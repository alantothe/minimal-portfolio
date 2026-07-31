# Runtime content persistence for the Railway app

Research for [Choose runtime content persistence for the Railway app](https://github.com/alantothe/minimal-portfolio/issues/29), current through 2026-07-30.

## Decision

Use **SQLite on the Railway persistent volume for V1**.

Store the database at an absolute runtime path such as `/data/content.sqlite`. Keep the app at one Railway replica. Use one application-owned database module and transactional writes. Enable foreign keys and WAL; keep `synchronous=FULL` because published content is durable product data, not a rebuildable cache.

SQLite fits the topology that exists now. PostgreSQL solves a future topology: multiple app instances, several independent writers, or recovery requirements tighter than scheduled volume snapshots. Choosing it now would add a second always-on service and operational surface without improving the current single-owner publishing path.

This decision chooses the storage engine, not the final content schema, publishing workflow, or backup policy. Those remain separate decisions.

## Current constraints from this repository

- [`railway.json`](../../railway.json) configures one always-on replica in one Railway region. No scale-out topology exists.
- [`Dockerfile`](../../Dockerfile) runs a single Bun 1.3.0 process.
- [`README.md`](../../README.md) already instructs Railway operators to attach a persistent volume at `/data` and place runtime Blog view data there.
- [`views.ts`](../../src/server/services/views.ts) serializes JSON mutations inside one process and atomically renames a replacement file. Its documented boundary is already one process/replica.
- Public Blog posts and Projects currently come from Markdown files in [`src/content`](../../src/content), read from the deployed image on each request. The current corpus is tiny: one Blog post and two Projects, about 13 KB of Markdown.
- The domain requires a private, mutable Content draft and a visitor-visible Published revision ([`CONTEXT.md`](../../CONTEXT.md)). Publishing must complete in seconds without waiting for a source commit and Railway rebuild.

Railway mounts a volume only at runtime, not during build or pre-deploy, and an absolute mount such as `/data` is directly readable and writable by the running container ([Railway: Using Volumes](https://docs.railway.com/volumes)). Runtime migrations therefore belong in application startup or an explicit runtime command, not the Docker build.

## Options compared

| Criterion                        | SQLite on app volume                                                                                                 | Railway PostgreSQL                                                                                                           | One JSON/document file on app volume                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Fit with current topology        | Excellent: embedded in existing Bun process and existing single-volume convention                                    | Works, but adds another network service and its own volume                                                                   | Superficially simple; resembles current Blog-view store                            |
| Publish latency                  | Local transaction; comfortably within seconds                                                                        | Network transaction; also comfortably within seconds                                                                         | Local rewrite; fast at this data size                                              |
| Draft + immutable revision model | Transactions, foreign keys, unique/check constraints, indexes, triggers                                              | Strong transactions, constraints, indexes, triggers                                                                          | All integrity, indexing, and cross-record atomicity become custom application code |
| Durability across deploys        | Persistent only when database and WAL sidecars live on `/data`                                                       | Database service persists on its attached volume                                                                             | Persistent only on `/data`                                                         |
| Deployment behavior              | Railway prevents replicas and overlapping deployments when a volume is attached; expect brief downtime on deploy     | App can later run replicas because persistence is outside the app service; DB remains a separate stateful service            | Same single-replica and deploy-downtime boundary as SQLite                         |
| Write concurrency                | WAL allows readers with a writer, but only one writer at a time                                                      | Designed for many concurrent sessions through MVCC                                                                           | Current queue protects only one process; no safe multi-process writer design       |
| Bun integration                  | `bun:sqlite` is built in; prepared statements and transactions need no package or DB connection management           | Bun has a native PostgreSQL client, but app must manage connection configuration, pooling/retries, and a remote failure mode | Built-in file APIs, but bespoke persistence code grows with every content rule     |
| Backup/restore                   | Railway volume backups include SQLite; safe logical snapshots also available with SQLite backup API or `VACUUM INTO` | Same Railway volume snapshots; PostgreSQL also has `pg_dump`, and Railway now offers optional PITR                           | Volume snapshot or whole-file copy; custom validation and restore tooling          |
| Migration later                  | Explicit export/import needed; easy while corpus is small if schema stays portable                                   | Destination platform                                                                                                         | Migration gets harder as one document accumulates implicit relationships           |
| Cost/ops                         | Shares app compute; only used volume bytes are billed, and repo already needs that volume for Blog views             | Adds service CPU/RAM plus volume use; Railway describes its PostgreSQL template as unmanaged                                 | Shares app compute and volume, but shifts DB work into application code            |

Railway charges resource usage for CPU, RAM, network egress, and volume storage; a separate PostgreSQL service therefore has a real, workload-dependent cost even when the dataset is small ([Railway: Pricing Plans](https://docs.railway.com/pricing/plans)). Railway's PostgreSQL template is easy to provision and exposes `DATABASE_URL`, but Railway explicitly calls the template unmanaged and leaves its maintenance and observability to the operator ([Railway: PostgreSQL](https://docs.railway.com/databases/postgresql)).

## Why SQLite meets the product behavior

### Fast, atomic publishing

SQLite transactions are ACID and either apply completely or not at all, including through application or operating-system crashes ([SQLite: Transactional](https://www.sqlite.org/transactional.html)). Bun's built-in driver provides prepared statements and transaction wrappers; an exception rolls a transaction back ([Bun: SQLite](https://bun.sh/docs/runtime/sqlite)).

A later schema decision can model publication as one short transaction:

1. Validate the Content draft.
2. Insert a new Published revision snapshot.
3. Point the content item's public revision reference at that new row.
4. Commit.

Visitors see either the previous Published revision or the complete new one. No build or Railway deploy sits in this request path, so “within seconds” is an easy target.

Private drafts and immutable Published revisions are **schema and authorization rules**, not reasons to require a client/server database. Keep drafts in separate rows/tables never queried by public handlers. Make published snapshots append-only: application code should not expose update/delete operations, and database triggers can reject them. A publish transaction changes only the pointer to the visible snapshot.

### Adequate concurrency now

SQLite WAL lets readers proceed while a writer commits, but retains one-writer-at-a-time semantics ([SQLite: WAL](https://www.sqlite.org/wal.html)). Bun recommends WAL for applications with concurrent readers and one writer ([Bun: SQLite](https://bun.sh/docs/runtime/sqlite#wal-mode)).

That boundary matches one Portfolio owner, one Bun process, and low-frequency publishing. Configure a finite busy timeout and keep write transactions short so an unexpected long writer produces a controlled error instead of an indefinite wait.

PostgreSQL becomes better when independent processes or many editors write concurrently: its MVCC model lets sessions read consistent snapshots while concurrent sessions update data ([PostgreSQL: MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html)).

### Minimal Bun integration

`bun:sqlite` ships with Bun and supports file databases, strict parameter binding, prepared statements, and transactions ([Bun: SQLite](https://bun.sh/docs/runtime/sqlite)). No dependency, TCP connection, credential, or connection pool is required.

Use an application-owned content repository interface rather than exposing `bun:sqlite` throughout handlers. This keeps SQL and engine-specific details in one deep module and gives a later PostgreSQL migration a bounded seam.

Do not assume identical SQL makes migration automatic. Bun also offers one `SQL` API for SQLite and PostgreSQL, but its docs call out SQLite's flexible types and engine-specific behavior ([Bun: SQL](https://bun.sh/docs/runtime/sql)). Portable domain types, migrations, and repository tests matter more than a shared client syntax.

## Railway durability and deployment behavior

The database file must live on the mounted volume. Railway deployment filesystems are ephemeral; persistent data requires a volume ([Railway: Deployments](https://docs.railway.com/deployments/reference#ephemeral-storage)). Put the main database and SQLite's `-wal`/`-shm` sidecars in the same `/data` directory.

Important tradeoffs:

- Railway allows only one volume per service and prohibits replicas on a service with a volume.
- Railway prevents two deployments from mounting that service's volume simultaneously, producing brief downtime during deploy even with a health check.
- Region changes migrate the volume and cause downtime.
- A volume mounts only when the service starts, so startup is the earliest migration point.

These are Railway platform limits, not SQLite limits ([Railway: Volumes](https://docs.railway.com/volumes/reference), [Railway: Regions](https://docs.railway.com/deployments/regions)). They are acceptable because the repo already intentionally runs one always-on replica and already depends on `/data` for Blog views. They also define the clearest PostgreSQL migration trigger.

Recommended SQLite safety settings:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

`synchronous=FULL` adds a WAL sync per commit and preserves durability across power loss; `NORMAL` can roll back a reported commit after power or operating-system failure ([SQLite: synchronous pragma](https://www.sqlite.org/pragma.html#pragma_synchronous)). Content publishing favors correctness over a small latency optimization.

Run all migrations in transactions where SQLite permits it. On startup, fail readiness if the volume is absent/unwritable, migrations fail, or `PRAGMA quick_check` reports corruption. Never silently fall back to an ephemeral path in production.

## Backup and restore implications

Railway explicitly supports manual and scheduled backups for volumes, including volumes containing SQLite databases. Available schedules are daily (retained 6 days), weekly (retained 1 month), and monthly (retained 3 months) ([Railway: Backups](https://docs.railway.com/volumes/backups)).

Minimum V1 posture:

1. Enable daily, weekly, and monthly Railway volume backups.
2. Trigger a manual backup before schema migrations or bulk imports.
3. Perform and document a restore drill before calling storage production-ready.
4. Add a periodic application-consistent logical export to a different failure domain once the backup-policy ticket is resolved.

Railway volume backups alone are not full disaster recovery: they restore only into the same project and environment, and wiping a volume deletes its backups ([Railway: Backups](https://docs.railway.com/volumes/backups#caveats)).

Do not implement an external backup by copying only `content.sqlite` while the app is writing. In WAL mode, the database state can include the `-wal` file; SQLite warns that a live raw copy can be inconsistent and recommends its Online Backup API, `VACUUM INTO`, or `sqlite3_rsync` for a consistent live snapshot ([SQLite: How to corrupt a database](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active), [SQLite: Backup API](https://www.sqlite.org/backup.html)).

PostgreSQL has stronger recovery options when required. `pg_dump` creates consistent logical backups without blocking readers or writers ([PostgreSQL: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)). As of 2026-07-30, Railway also offers optional PostgreSQL point-in-time recovery using pgBackRest, daily incremental and weekly full base backups, and WAL replay over roughly four weeks; it adds bucket storage and network-egress cost ([Railway: Point-in-Time Recovery](https://docs.railway.com/volumes/point-in-time-recovery)).

## Migration path to PostgreSQL

Keep migration practical from day one:

- Put storage behind one content repository interface.
- Use explicit IDs, UTC timestamps, booleans normalized by the repository, and JSON only where the value is genuinely document-shaped.
- Use foreign keys and constraints in both engines.
- Avoid SQLite-only virtual tables, implicit row IDs, and loose column typing for core domain records.
- Keep ordered, versioned SQL migrations with repository integration tests.
- Keep media blobs outside the content DB; store stable media references.
- Build a deterministic export containing every Content draft, Published revision, public pointer, and migration version.

When migration is triggered:

1. Provision Railway PostgreSQL and run its schema migrations.
2. Export SQLite rows as typed JSON or CSV from a consistent snapshot.
3. Import into PostgreSQL and verify row counts, foreign keys, current public pointers, and representative rendered pages. Both SQLite and PostgreSQL provide CSV tooling ([SQLite CLI](https://www.sqlite.org/cli.html#csv), [PostgreSQL: COPY](https://www.postgresql.org/docs/current/sql-copy.html)).
4. Briefly disable Owner-workspace writes, perform a final delta/export, and switch the repository configuration to `DATABASE_URL`.
5. Keep the SQLite volume and tested backup untouched through a rollback window.

## Explicit migration triggers

Move to PostgreSQL when **one** of these becomes a committed requirement, not after failure:

1. More than one app replica, rolling deploys without the volume's forced downtime, or multiple regions.
2. A background worker, separate service, or external tool must write content independently of the web process.
3. Multiple Portfolio owners/editors create sustained write contention or visible `SQLITE_BUSY` errors despite short transactions and a busy timeout.
4. Recovery-point objective becomes finer than scheduled snapshots and requires supported point-in-time recovery.
5. Availability requires DB failover/HA independent of the web service.
6. Operational measurements—not forecast traffic—show the single writer or local volume is the bottleneck.

Database size alone is unlikely to be the first trigger for this portfolio. Topology, write concurrency, and recovery objectives are more meaningful boundaries.

## Why not the alternatives now

### Railway PostgreSQL

Technically sound, but premature. It gives shared persistence, multi-session concurrency, independent app scaling, standard logical backups, and optional PITR. Current product has one owner, one app process, tiny content, and no requirement for zero-downtime deployments or multiple writers. Its second service, credentials, connection lifecycle, monitoring, and higher resource use buy unused capability.

### One JSON/document file

Too shallow for this domain. The existing Blog-view JSON store is appropriate for one map of counters. Content adds identity, drafts, immutable revisions, visibility pointers, validation, list queries, and migrations. Rebuilding transactions, constraints, indexes, and restore validation in TypeScript would be more code and less safety than embedded SQLite.

### Git as the runtime store

Keep Git as source history for application code, not as the Owner workspace's publish path. The current Git → CI → Railway deployment workflow is valuable for code, but a commit/build/deploy cycle conflicts with publish-within-seconds and makes private drafts awkward.

### External KV/document service

It removes the local-volume constraint but introduces another vendor/network service while providing weaker relational guarantees than PostgreSQL. No current requirement justifies that middle ground. If remote shared storage becomes necessary, move directly to PostgreSQL.

## Final recommendation

Adopt SQLite on `/data` for V1 with WAL, full synchronous durability, transactional publishing, scheduled Railway volume backups, tested restores, and a storage interface that isolates engine details.

Record PostgreSQL as the planned successor—not a rejected technology—when replica, independent-writer, high-concurrency, HA, or PITR requirements cross the explicit triggers above.
