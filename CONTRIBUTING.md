# Development workflow

Production deploys from `main` only. GitHub protects `main`, runs CI on every
pull request, and deploys a merged commit to Railway after CI passes.

## Make a change

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description

bun install
bun run dev
```

Make and test the change, then run:

```bash
bun run check
git status
git diff
git add path/to/intended-file
git commit -m "Describe the change"
git push -u origin feature/short-description
```

Open a pull request into `main`. Review the Files changed tab and wait for the
required `check` job to pass. Resolve any open review conversations, then use
**Squash and merge**.

After the merge, GitHub Actions checks `main`, deploys it to Railway, waits for
Railway's health check, and verifies the public `/healthz` endpoint. GitHub
automatically deletes the merged feature branch.

Refresh locally before the next change:

```bash
git switch main
git pull --ff-only
```

## Do

- Use one short-lived feature branch per change.
- Start each branch from current `main`.
- Keep pull requests small enough to review in one sitting.
- Run `bun run check` before pushing.
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
