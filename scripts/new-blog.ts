/**
 * Interactive script to create a new blog post
 * Usage: bun scripts/new-blog.ts
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Helper function to prompt user input
async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data) => {
      input = data.toString().trim();
      resolve(input);
    });
  });
}

// Generate slug from title (lowercase, replace spaces with hyphens)
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function main() {
  console.log("\n📝 Create a new blog post\n");

  const title = await prompt("Blog title: ");
  if (!title) {
    console.error("❌ Title is required");
    process.exit(1);
  }

  const excerpt = await prompt("Excerpt (brief summary): ");
  if (!excerpt) {
    console.error("❌ Excerpt is required");
    process.exit(1);
  }

  const dateInput = await prompt(
    `Date (YYYY-MM-DD) [${getTodayDate()}]: `
  );
  const date = dateInput || getTodayDate();

  const slug = generateSlug(title);
  const blogDir = join(process.cwd(), "src/content/blog");
  const filePath = join(blogDir, `${slug}.md`);

  // Ensure blog directory exists
  mkdirSync(blogDir, { recursive: true });

  // Generate frontmatter
  const content = `---
title: ${title}
date: ${date}
excerpt: ${excerpt}
---

# ${title}

Start writing your blog post here...
`;

  writeFileSync(filePath, content, "utf-8");

  console.log(`\n✅ Blog post created!\n`);
  console.log(`📄 File: ${filePath}`);
  console.log(`📖 View at: http://localhost:8000/blog/${slug}\n`);
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
