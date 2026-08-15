# Cutover operations

This runbook implements the cutover decision in issue #36 and Slice 10 in
issue #47. Merging the slice deploys code; it does **not** change what Visitors
see. Production stays in `legacy` until an operator advances the persisted
phase.

## Phases

`legacy → shadow → sqlite-observation → sealed`

| Phase                | Public content                                           | Blog views | Owner publication | Rollback                              |
| -------------------- | -------------------------------------------------------- | ---------- | ----------------- | ------------------------------------- |
| `legacy`             | repository files                                         | JSON       | disabled          | n/a                                   |
| `shadow`             | repository files; published generation is built off-path | JSON       | disabled          | return to `legacy`                    |
| `sqlite-observation` | published SQLite generation                              | JSON       | disabled          | return to `legacy`                    |
| `sealed`             | published SQLite generation                              | SQLite     | enabled           | never back to files; restore a backup |

A sealed process refuses `CUTOVER_FORCE_LEGACY_CONTENT=1` at startup.

## Commands

```bash
bun run cutover:status
bun scripts/cutover.ts advance shadow
bun scripts/cutover.ts advance sqlite-observation
bun run shadow:parity
bun scripts/cutover.ts reconcile-views
bun scripts/cutover.ts reconcile-views --commit
bun scripts/cutover.ts advance sealed --confirm-checks
bun scripts/cutover.ts rollback legacy
```

`--confirm-checks` is the operator attesting that parity, view totals, backup,
restore, auth, media, and 24-hour observation are complete. The machine will
not seal without it.

## Production procedure

1. Capture a golden legacy crawl (`bun run baseline:check`) plus view totals.
2. Deploy the database-capable release. Confirm `/readyz` reports `legacy`.
3. Take Railway and encrypted R2 checkpoints. See `docs/runbooks/recovery.md`.
4. Lock Owner publishing (already locked until `sealed`).
5. Run the deterministic production import into SQLite.
6. `bun scripts/cutover.ts advance shadow`. Confirm SQLite, GitHub auth,
   Cloudinary/R2, `/healthz`, and `bun run shadow:parity`. A failed check stays
   on legacy content; roll the release back if needed.
7. `bun scripts/cutover.ts advance sqlite-observation`. Public reads move to
   the published generation. Views stay in JSON. Observe at least 24 hours for
   5xx, snapshot build failure, route/SEO diff, broken media, and abnormal
   latency. `/readyz` now fails the deploy if the generation cannot be built.
8. Pause view writes briefly. `bun scripts/cutover.ts reconcile-views` then
   `--commit`. Per-post and total counts must match.
9. `bun scripts/cutover.ts advance sealed --confirm-checks`. Views and
   publication switch to SQLite. Repository files are no longer a runtime
   fallback.
10. Smoke-test public pages and one Owner draft → preview → publish → history
    flow. Take a post-cutover backup.

## Rollback

- Before `sqlite-observation`: disable the candidate release. Legacy data was
  never changed. `bun scripts/cutover.ts rollback legacy` if the phase already
  moved to `shadow`.
- During `sqlite-observation`: `bun scripts/cutover.ts rollback legacy`. JSON
  views are still current and no database-authored publication exists.
- After `sealed`: never roll back to repository content. Restore the latest
  valid SQLite/Media checkpoint and deploy the previous database-compatible
  image, or publish a corrected immutable revision.

## Operator

Portfolio owner. Expected duration: import and parity in one sitting; 24 hours
of observation; seal in a second sitting. Escalation: restore from the latest
verified recovery checkpoint and keep or return the phase to `legacy` until
seal.
