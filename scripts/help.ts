const help = `
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
  1. Start one change from current main:
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
     Squash and merge

  7. Automatic production pipeline:
     GitHub checks main
     Railway deploys production
     Public /healthz is verified

  8. After merge, clean local branch:
     bun run work:finish

USEFUL COMMANDS
  bun run work:status   Show current branch and next safe action
  bun run work:learn    Open guided workflow lesson
  bun run check         Run typecheck and tests
  bun run start         Run production mode locally

IMPORTANT
  Never push directly from main.
  Never commit .env files or secrets.
  Merging a green PR starts production deployment automatically.

Full guide: WORKFLOW.md
`.trim();

console.log(help);
