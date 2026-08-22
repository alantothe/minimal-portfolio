const projectHelpText = `
PORTFOLIO HELP

LOCAL APP
  First setup only:
    bun install

  Start development server:
    bun run dev

  Then open:
    http://localhost:8000

  Stop server:
    Ctrl+C

FEATURE -> GITHUB -> PRODUCTION
  1. Sync GitHub main and create a local feature branch:
     bun run work:start "change description"

  2. Start app and make your changes:
     bun run dev

  3. Review and test:
     git status
     git diff
     bun run check

  4. Save intended files:
     git add path/to/file
     git commit -m "Describe the change"

  5. Test, push feature branch, and open draft PR:
     bun run work:submit

  6. On GitHub:
     Review Files changed
     Wait for green check
     Mark Ready for review
     Resolve open conversations
     Squash and merge

  7. Automatic production pipeline:
     GitHub checks main
     Railway deploys production
     Public /healthz is verified
     Check GitHub Actions after merge

  8. After merge, clean local branch:
     bun run work:finish

USEFUL COMMANDS
  bun run work:status   Show current branch and next safe action
  bun run work:learn    Open guided workflow lesson
  bun run check         Run typecheck and tests
  bun run start         Run production mode; requires HTTPS SITE_URL

CONTENT COMMANDS
  bun scripts/new-blog.ts       Create a blog post
  bun scripts/new-project.ts    Create a project

RECOVERY COMMANDS
  bun run db:pull-local            Replace local DB from sanitized production snapshot
  bun run recovery:status         Show safe backup/drill status
  bun run recovery:checkpoint     Create verified encrypted checkpoint
  bun run recovery:fixture-drill  Prove restore with isolated fixture
  Full runbook: docs/runbooks/recovery.md

CUTOVER COMMANDS
  bun run cutover:status          Show persisted phase and serving policy
  bun scripts/cutover.ts advance shadow|sqlite-observation|sealed [--confirm-checks]
  bun scripts/cutover.ts rollback legacy
  bun scripts/cutover.ts reconcile-views [--commit]
  Full runbook: docs/runbooks/cutover.md

IMPORTANT
  Never push directly from main.
  Never commit .env files or secrets.
  Merging a green PR starts production deployment automatically.

Full guide: WORKFLOW.md
`.trim();

console.log(projectHelpText);
