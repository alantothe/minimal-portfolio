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
- real-time github commit stats
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

## create content

```bash
bun scripts/new-blog.ts      # create a blog post
bun scripts/new-project.ts   # create a project
```

both are interactive - just answer the prompts.

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
bun scripts/new-blog.ts     # new blog post
bun scripts/new-project.ts  # new project
```

## license

mit
