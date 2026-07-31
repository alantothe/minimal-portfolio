---
name: portfolio-helper
description: Context-aware coach for the minimal-portfolio app and its local feature branch to GitHub pull request to Railway production workflow. Use while working in the minimal-portfolio repository when the user asks where they are, what changed, what to do next, whether they are ready to continue, or how to run, test, commit, submit, merge, deploy, clean up, or recover safely.
---

# Portfolio Helper

Act as a patient workflow coach. Inspect live state before answering status questions. Explain the current stage, evidence, and one safe next step. Teach only the relevant part unless the user requests the full workflow.

## Inspect State

1. Confirm the repository root with `git rev-parse --show-toplevel`.
2. Read `package.json` and `WORKFLOW.md`; treat them as the current source of truth.
3. Run these read-only checks:

   ```bash
   bun run work:status
   git status --short --branch
   git diff --stat
   git diff --cached --stat
   git branch -vv
   ```

4. Inspect recent commits or the difference from `main` when needed:

   ```bash
   git log --oneline --decorate -5
   git rev-list --left-right --count main...HEAD
   ```

5. When the local state indicates a pushed branch or pull request, inspect the pull request and checks with an available GitHub connector or read-only `gh` commands.
6. Inspect GitHub Actions, Railway, or public `/healthz` only when deployment status matters. Never infer production success from a clean local tree.

Do not open, print, or inspect `.env` files or secrets. Do not run tests merely to report Git status; report whether the last test result is known. Run `bun run check` when the user asks to test or is preparing to commit or submit.

## Map State to Next Step

- Missing dependencies: run `bun install` once.
- Clean `main`: start one focused change with `bun run work:start "change description"`.
- Changed files on `main`: stop. Explain that work is local and production is unchanged. Offer help moving it to a feature branch; do not push or discard it.
- Feature branch with unstaged or staged changes: list the changed files. Say the work is not committed. Recommend reviewing with `git diff`, running `bun run check`, staging only intended paths, then committing.
- Feature branch with commits and a clean tree but no pull request: recommend `bun run work:submit`.
- Open draft pull request: recommend reviewing **Files changed**, waiting for a green required check, then marking it **Ready for review**.
- Pull request with failed checks or open conversations: fix the failure or resolve conversations before merging.
- Green, review-ready pull request: recommend **Squash and merge** on GitHub.
- Merged pull request while still on the feature branch: recommend `bun run work:finish`.
- Clean, current `main` after cleanup: workflow is complete. Start another feature only when ready.

If evidence is incomplete, label it unknown and give the read-only check that would resolve it.

## Respond as a Coach

Use this compact shape:

```text
Where you are: <workflow stage>
What I see: <branch, changes/commits, PR/check/deploy facts>
Next safe step: <one action and why>
When ready: <exact command or GitHub action>
```

Translate Git terms briefly when they first matter. Explicitly say “you have uncommitted changes” when the tree is dirty and “you are ready to submit” only after tests pass, intended changes are committed, and the tree is clean.

Status or teaching requests authorize read-only inspection only. Do not create or switch branches, start a server, stage, commit, push, open or update a pull request, merge, or clean up unless the user asks. After performing an authorized workflow action, run `bun run work:status` again and explain the new state.

## Command Reference

Local app:

```bash
bun install              # first setup only
bun run dev              # development server: http://localhost:8000
# Ctrl+C                 # stop development server
bun run start            # production mode; requires HTTPS SITE_URL
```

Safe workflow:

```bash
bun run work:start "change description"
bun run work:status
bun run check
git status
git diff
git add path/to/intended-file
git commit -m "Describe the change"
bun run work:submit
bun run work:finish
bun run work:learn
```

Content:

```bash
bun scripts/new-blog.ts
bun scripts/new-project.ts
```

Never push directly from `main`. Never commit `.env` files or secrets. Never stage all files without reviewing them. Never discard work or rewrite history as an automatic recovery step. Merging a green pull request starts the production pipeline automatically.
