---
name: pull-production-database
description: Refresh minimal-portfolio's ignored local SQLite content database from a validated, sanitized production snapshot. Use when the user asks to pull, copy, or refresh production content for local testing without syncing local changes back.
---

# Pull Production Database

Run the repository's tested one-way pull command. Do not recreate its Railway or
SQLite operations manually.

## Boundaries

- Treat this as production read plus recoverable local replacement. It never
  authorizes a local-to-production sync, production database changes, or uploads.
- Do not inspect `.env` files, print secrets, register SSH keys, stop processes,
  commit code, or deploy unless the user separately asks.
- Execute the pull only when the user asks to refresh or copy data. For questions
  about the workflow, explain it without running the command.
- Run only inside the `minimal-portfolio` repository after confirming
  `package.json` contains `db:pull-local`.

## Refresh Workflow

1. Tell the user the local database will be replaced and its current copy kept at
   `src/data/content.sqlite.before-production-pull`.
2. Run:

   ```bash
   bun run db:pull-local
   ```

3. Do not retry automatically after failure. Follow these bounded responses:

   - If local database is in use, ask the user to stop `bun run dev`, then wait.
   - If Railway reports missing SSH authentication, ask the user to run
     `railway ssh keys add`, then wait.
   - If production lacks `scripts/pull-production-database.ts`, explain that the
     feature branch must be merged and deployed before pulling.
   - For any other failure, report the exact safe error without exposing command
     environment or credentials.

4. On success, report snapshot generation when shown, confirm authentication
   sessions were excluded, name the local backup path, and tell the user they can
   restart with `bun run dev`.

The command owns consistency checks, authentication-state removal, production
temporary-file cleanup, downloaded database validation, and atomic local install.
