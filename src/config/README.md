# User Configuration

Everything starts here. Open `src/config/index.ts` and customize these sections with your personal information:

- **Logo** - Replace `src/public/logo.png` with your 60px logo
- **Home Page** - Your name, title, bio, avatar, and email
- **About Page** - Your story, hobbies, social links, and custom sections
- **GitHub** - Setup instructions for commit statistics (requires `.env` file)

All fields in `index.ts` have comments explaining what to update and how.

## Quick Checklist

Follow this checklist to get your portfolio ready:

- [ ] Update your name and email in `index.ts`
- [ ] Update your professional title and bio
- [ ] Replace logo at `src/public/logo.png` (60px wide)
- [ ] Replace avatar image - store in `src/public/` or use a CDN URL
- [ ] Update about page (intro, hobbies, social links)
- [ ] Create `.env` file in project root and add GitHub token for live stats
- [ ] Create your first blog post: `bun scripts/new-blog.ts`
- [ ] Create your first project: `bun scripts/new-project.ts`
- [ ] Run `bun run dev` and preview at http://localhost:8000

## Image Hosting

**Avatar & Logo:**

- Store locally in `src/public/` folder, or
- Upload to a CDN (Cloudinary, etc.) and use the URL

**Blog & Project Cover Images:**

- Upload to Cloudinary or similar CDN
- Use the CDN URL in the `image` field when creating projects
- Recommended size for project covers: 300×180px

## Creating Content

### Blog Posts

Run the interactive script:

```bash
bun scripts/new-blog.ts
```

It will prompt you for:

- Blog title
- Excerpt (brief summary)
- Date (defaults to today)

Creates a markdown file in `src/content/blog/` with frontmatter.

### Projects

Run the interactive script:

```bash
bun scripts/new-project.ts
```

It will prompt you for:

- Project title
- Description
- Cloudinary image URL
- Date (defaults to today)

Creates a project folder in `src/content/projects/` with a `content.md` file.

Both scripts generate files with boilerplate content you can edit.

## GitHub Token Setup

To display live GitHub commit counts and the yearly contribution heatmap:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select `public_repo` scope
4. Copy the token
   - Add `read:user` only if you want anonymized private contribution counts.
5. Create a `.env` file in the project root:

```
GITHUB_TOKEN=ghp_your_token_here
GITHUB_USERNAME=your_github_username
```

6. Restart dev server: `bun run dev`

The `.env` file is already in `.gitignore` so your token stays safe.
