# Development workflow

Production deploys from `main` only. GitHub protects `main`, runs CI on every
pull request, and deploys a merged commit to Railway after CI passes.

## Recommended guided workflow

New to Git? Read [WORKFLOW.md](./WORKFLOW.md), then run:

```bash
bun run work:learn
```

For normal daily use:

```bash
bun run work:start
bun run dev

# Make one focused change.
bun run check
git status
git diff
git add path/to/intended-file
git commit -m "Describe the change"
bun run work:submit
```

Review the draft pull request's Files changed tab and wait for required `check`
to pass. Mark it Ready for review, resolve open conversations, then use **Squash
and merge**.

After the merge, GitHub Actions checks `main`, deploys it to Railway, waits for
Railway's health check, and verifies the public `/healthz` endpoint. GitHub
automatically deletes the merged feature branch.

After GitHub says the pull request is merged:

```bash
bun run work:finish
```

## Do

- Use one short-lived feature branch per change.
- Start each branch from current `main`.
- Keep pull requests small enough to review in one sitting.
- Use `bun run work:status` whenever unsure.
- Use `bun run work:submit` so checks run before pushing.
- Read the diff and confirm only intended files are included.
- Check the GitHub Actions result after merging.
- Review your own pull request carefully; this is currently a solo repository,
  so no second-person approval is required.

## Do not

- Do not make routine changes directly on `main`.
- Do not merge while the required check is red or running.
- Do not commit `.env` files, tokens, passwords, or API keys.
- Do not force-push or delete `main`.
- Do not reuse an old merged branch for unrelated work.
- Do not deploy from a laptop during the normal workflow. Manual Railway deploys
  are for intentional recovery only.
- Do not bypass hooks with `--no-verify` during routine work.
