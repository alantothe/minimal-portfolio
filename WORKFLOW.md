# Safe Git workflow

This project uses guardrails so routine changes follow one path:

```text
local feature branch
  -> feature branch on GitHub
  -> pull request
  -> required checks
  -> squash merge into main
  -> Railway production deployment
  -> public health check
```

`main` is the approved source of truth. Railway production runs code deployed
from `main`. A feature branch is temporary workspace for one change.

## Daily routine

### 1. Start safely

```bash
bun run work:start
```

The command requires a clean `main`, downloads current GitHub `main`, asks for a
short description, and creates `feature/<description>`.

### 2. Work locally

```bash
bun run dev
```

The startup log shows current branch and next safe command. Make one focused
change and test it in the browser.

Check your state whenever unsure:

```bash
bun run work:status
```

### 3. Review and commit

```bash
git status
git diff
git add path/to/intended-file
git commit -m "Describe the change"
```

Staging and committing stay manual. This prevents automation from including an
unintended file or secret.

### 4. Submit

```bash
bun run work:submit
```

The command:

- refuses to submit from `main`
- requires a clean working tree and at least one feature commit
- blocks common secret-file names
- runs typechecking and tests
- pushes the feature branch
- opens a draft pull request

In GitHub, review **Files changed**, wait for required `check` to pass, mark the
pull request **Ready for review**, then use **Squash and merge**.

### 5. Clean up

After GitHub says the pull request is merged:

```bash
bun run work:finish
```

The command verifies the pull request is merged and that no newer local commits
would be lost. It then updates local `main` and deletes the merged local feature
branch.

## Learn with the guided wizard

For a full guided practice cycle:

```bash
bun run work:learn
```

Keep the wizard open in one terminal and run the local server in another. It
pauses at each decision, opens the pull request, and explains what to inspect.
It never reads, writes, or asks for environment values or secrets.

## What each word means

- **Working tree:** files currently on your computer.
- **Commit:** saved checkpoint in Git history.
- **Branch:** named line of commits.
- **Push:** upload local commits to GitHub.
- **Pull request:** proposed change from a feature branch into `main`.
- **CI/check:** GitHub robot running typechecking and tests.
- **Merge:** accept pull-request changes into `main`.
- **Deploy:** build and run `main` on Railway.
- **Health check:** request proving the deployed server started successfully.

## Guardrail layers

### Local

- Development startup banner shows branch safety.
- Workflow commands reject unsafe Git states.
- Pre-commit hook formats staged files, typechecks, and tests.
- Pre-push hook blocks `main` and runs final checks.

Local hooks can be bypassed, so they are convenience guardrails—not final
security.

### GitHub

GitHub is the final gate:

- `main` requires a pull request
- required `check` must pass
- branch must be current with `main`
- review conversations must be resolved
- force-push and deletion are blocked
- only squash merge is enabled

### Railway

After `main` passes GitHub CI, GitHub Actions uploads it to Railway, waits for
Railway to report `SUCCESS`, then checks the public `/healthz` endpoint.

## Mistake recovery

### I edited files on `main` but did not commit

Do not push. Check:

```bash
bun run work:status
git status
git diff
```

Your work is still local and production is unchanged. Ask for help moving it to
a feature branch before running destructive Git commands.

### I committed on local `main`

Do not push. GitHub will reject the direct push, but local history needs careful
repair. Keep the commit and ask for help moving it onto a feature branch. Do not
use `reset --hard` without reviewing the exact target.

### Tests are red

Do not merge. Read the failing test, fix the change, run `bun run check`, commit,
and push again. The pull request updates automatically.

### Deployment is red

Check three separate facts:

1. Did GitHub `check` pass?
2. What status does Railway show?
3. Does the live `/healthz` endpoint respond?

A reporting failure does not always mean the live site is down. Never panic-push
another change.

### A merged change broke production

Use GitHub's **Revert** action to create a new commit that undoes the merge.
Submit that revert through the same pull-request checks. Do not delete or rewrite
`main` history.

### A secret was committed

Stop. Do not push. If it reached GitHub, rotate the secret immediately; deleting
the file in a later commit does not remove it from existing history.

## Commands

```bash
bun run work:start     # begin one feature safely
bun run work:status    # explain current Git state
bun run work:submit    # test, push, and open draft PR
bun run work:finish    # sync main and remove merged local branch
bun run work:learn     # guided full workflow
bun run dev            # local development server
bun run check          # typecheck and test
```
