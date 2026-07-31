# Golden contract

`golden-contract.json` is a frozen description of everything the public site
does today. It exists so the migration slices that follow can prove they changed
nothing a Visitor can see.

## Using it

```
bun run baseline:check     # compare the current site against the baseline
bun run baseline:capture   # overwrite the baseline with the current site
```

`bun run check` already runs the comparison as part of the test suite, and CI
runs `bun run check`, so a change that alters public behaviour fails before it
can merge.

## When the check fails

The failure lists every field that moved, with the baseline value and the
current one. Read it before doing anything else.

- **The change was not supposed to be visible.** The diff is the bug. Fix the
  code, not the baseline.
- **The change was intended** — new Blog post, edited copy, a deliberate design
  change. Run `bun run baseline:capture` and commit the updated artifact in the
  same pull request. The diff is then part of review, which is the point:
  re-capturing is a visible, deliberate act rather than a side effect.

## What it records

| Section   | Contents                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes`  | Every public route, with status, content type, cache headers, redirect target, body hash, normalized-text hash, heading hierarchy, internal links, images with alt text, and full SEO output including JSON-LD |
| `content` | SHA-256 and byte length of every Markdown, page-template, and config source a page is rendered from                                                                                                            |
| `media`   | SHA-256 and byte length of every image in `src/public`                                                                                                                                                         |
| `views`   | Blog view counts per slug and in total, read from the committed store                                                                                                                                          |

The route list is derived from committed content rather than hand-written, so a
new Blog post or Project widens the contract automatically instead of quietly
escaping it.

## Reproducibility

A capture must produce identical bytes on any machine, on any day, with or
without network access. Three inputs would otherwise break that, and
`src/baseline/environment.ts` pins all three:

- `SITE_URL` differs between local and production, so canonical URLs are
  captured against the sentinel origin `https://baseline.test`. The contract
  describes route structure, not the hostname of whoever ran it.
- `GITHUB_TOKEN` / `GITHUB_USERNAME` turn on a live GitHub contribution heatmap
  on the Home page — dated, networked, and different tomorrow. Cleared, the
  GitHub services fall back to configured values without touching the network.
- `BLOG_VIEWS_FILE` points at a mounted volume in production. The capture reads
  the committed store instead.

The crawl never sends `?view=1`, so capturing can never increment a Blog view.

## Not covered

**Responsive screenshots.** The parity contract in
[#36](https://github.com/alantothe/minimal-portfolio/issues/36) also calls for
desktop and mobile screenshots. They are deliberately not part of this artifact:
they need a headless browser in CI, and rendered pixels are not reproducible
across platforms or font stacks, so they cannot satisfy "a rerun produces an
identical report". They belong in a separate visual-diff job with its own
tolerance rules, reviewed by eye rather than by hash.
