/**
 * Interactive script to create a new project
 * Usage: bun scripts/new-project.ts
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
  console.log("\n🚀 Create a new project\n");

  const title = await prompt("Project title: ");
  if (!title) {
    console.error("❌ Title is required");
    process.exit(1);
  }

  const description = await prompt("Project description: ");
  if (!description) {
    console.error("❌ Description is required");
    process.exit(1);
  }

  const image = await prompt(
    "Cloudinary image URL (with c_fill,w_300,h_180 transformation): "
  );
  if (!image) {
    console.error("❌ Image URL is required");
    process.exit(1);
  }

  const dateInput = await prompt(`Date (YYYY-MM-DD) [${getTodayDate()}]: `);
  const date = dateInput || getTodayDate();
  const technologyInput = await prompt(
    "Technologies (comma-separated, optional): "
  );
  const technologies = technologyInput
    .split(",")
    .map((technology) => technology.trim())
    .filter(Boolean)
    .slice(0, 20);
  const technologyFrontmatter = technologies.length
    ? `technologies:\n${technologies.map((technology) => `  - ${JSON.stringify(technology)}`).join("\n")}`
    : "technologies: []";

  const slug = generateSlug(title);
  const projectDir = join(process.cwd(), "src/content/projects", slug);
  const filePath = join(projectDir, "content.md");

  // Create project directory
  mkdirSync(projectDir, { recursive: true });

  // Generate frontmatter
  const content = `---
title: ${title}
description: ${description}
${technologyFrontmatter}
image: ${image}
gallery:
  - src: ${image}
    alt: ${title}
# Optional lead video (shown with native controls, max 1920×1080):
# video: /public/${slug}-demo.mp4
date: ${date}
---

Start describing your project here...

## Features

- Feature 1
- Feature 2
- Feature 3

## Technologies

- Technology 1
- Technology 2

## Link

[View Project](#)
`;

  writeFileSync(filePath, content, "utf-8");

  console.log(`\n✅ Project created!\n`);
  console.log(`📁 Folder: ${projectDir}`);
  console.log(`📄 File: ${filePath}`);
  console.log(`🌐 View at: http://localhost:8000/projects/${slug}\n`);
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
