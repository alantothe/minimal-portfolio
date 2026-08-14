# minimal portfolio

a lightweight personal portfolio and blog. customize in minutes, add content with cli tools.

https://github.com/user-attachments/assets/3516996e-6c8c-4123-bc20-fbfcd3a6d133

<h2 style="margin-bottom: 0.5rem;">built with:</h2>
<p>
<img alt="Bun" src="https://img.shields.io/badge/bun-00E0FF?style=for-the-badge&logo=bun&logoColor=white&color=333333"/>
<img alt="TypeScript" src="https://img.shields.io/badge/typescript-007ACC?style=for-the-badge&logo=typescript&logoColor=white"/>
<img alt="HTML5" src="https://img.shields.io/badge/html-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white"/>
<img alt="CSS" src="https://img.shields.io/badge/css-%231572B6.svg?style=for-the-badge&logo=css&logoColor=white"/>

## features

- single config file for all your info
- cli tools to create blogs and projects instantly
- real-time github commit stats with a yearly contribution heatmap
- lightning fast spa with instant page switching
- responsive mobile-first design
- markdown-based content

## quick start

```bash
git clone <repo-url> && cd minimal
bun install
bun run dev
```

then edit `src/config/index.ts` with your info.

development startup logs show the current git branch and next safe workflow
command. read [WORKFLOW.md](./WORKFLOW.md) before making changes.

need a quick command guide:

```bash
bun run help
```

## safe development workflow

```bash
bun run work:start     # sync main and create a feature branch
bun run work:status    # explain current branch and next action
bun run work:submit    # test, push, and open a draft pull request
bun run work:finish    # sync main after merge and delete local feature branch
bun run work:learn     # guided full workflow
```

routine changes never push directly from local `main`. github branch protection,
local hooks, pull-request checks, and railway health verification enforce the
path from feature branch to production.

## production environment

copy `.env.example` to your deployment environment and configure:

- `SITE_URL` — public HTTPS origin used for canonical and social URLs
- `HOST` / `PORT` — bind address assigned by your host
- `BLOG_VIEWS_FILE` — path on a writable persistent volume for blog view data
- `CONTENT_DATABASE_FILE` — path on the same volume for the content database;
  defaults to `/data/content.sqlite` in production and must be absolute there
- `GITHUB_USERNAME` / `GITHUB_TOKEN` — optional commit statistics

before sending production traffic:

- set `SITE_URL` to the final public origin
- mount persistent storage and point `BLOG_VIEWS_FILE` at it
- run `bun run check`
- verify `GET /readyz` reports `"status": "ready"`
- verify `GET /healthz`, `/robots.txt`, and `/sitemap.xml`

`/healthz` is liveness: the process is running. `/readyz` is readiness: the
content database opened, migrated, and passed its integrity check. railway
health-checks `/readyz`, so a deployment whose volume is missing or whose
migrations failed never replaces the instance currently serving visitors.

the content database runs one writer at a time with WAL and `synchronous=FULL`.
migrations apply automatically at startup and are append-only; never edit a
migration that has shipped, because startup refuses a database whose recorded
migrations no longer match the code.

the JSON view store safely serializes writes within one application process. run
one instance when view counts matter. use shared database or KV storage before
deploying to serverless or multiple replicas.

### railway

the included `Dockerfile` and `railway.json` run one always-on instance in
railway's us east region. attach a persistent volume at `/data`, then configure:

```text
SITE_URL=https://your-domain.example
BLOG_VIEWS_FILE=/data/blog-views.json
CONTENT_DATABASE_FILE=/data/content.sqlite
GITHUB_USERNAME=your-github-username
```

set `GITHUB_TOKEN` as a railway secret. railway provides `PORT`; do not set it
manually.

## create content

```bash
bun scripts/new-blog.ts      # create a blog post
bun scripts/new-project.ts   # create a project
```

both are interactive - just answer the prompts.

## configure production media

Run the interactive bootstrap from a private terminal:

```bash
bun run cloudinary:configure
```

The command hides both Cloudinary credentials, verifies them directly with
Cloudinary, creates missing portfolio resources, safely repairs a conflicting
project-owned named transformation to the exact application definition, and
stages the four production Railway variables through stdin. It refuses piped
input and refuses to overwrite a conflicting resource that is not one of the
expected named transformations. No `.env` file is created, and no deployment
is triggered. Railway sealing is dashboard-only, so seal
`CLOUDINARY_API_SECRET` from its three-dot menu before deploying.

## setup

see [src/config/README.md](./src/config/README.md) for:

- full customization guide
- github token setup
- blog & project specs (cover images: 300×180px)
- troubleshooting

## structure

```
src/config/index.ts         # edit this - your personal info
src/content/blog/           # blog posts (markdown)
src/content/projects/       # projects (markdown folders)
src/public/                 # logo, avatar, css
```

## commands

```bash
bun run dev                 # dev server
bun run start               # production
bun run check               # typecheck and test
bun run help                # quick local and deployment guide
bun run work:status         # explain current git state
bun run work:learn          # guided feature-to-production workflow
bun scripts/new-blog.ts     # new blog post
bun scripts/new-project.ts  # new project
```

## license

mit
