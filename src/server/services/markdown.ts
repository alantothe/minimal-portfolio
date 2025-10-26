/**
 * Markdown parsing service with YAML frontmatter and syntax highlighting
 */

import { marked } from 'marked';
import matter from 'gray-matter';
import hljs from 'highlight.js';

export interface BlogPostMetadata {
  title: string;
  date: string;
  slug?: string;
  [key: string]: any;
}

export interface BlogPost {
  metadata: BlogPostMetadata;
  content: string;
  html: string;
}

/**
 * Configure marked with syntax highlighting
 */
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (err) {
        console.error('Error highlighting code:', err);
      }
    }
    return hljs.highlightAuto(code).value;
  },
  langPrefix: 'hljs language-'
});

/**
 * Parse markdown file with YAML frontmatter
 */
export function parseMarkdown(markdownContent: string): BlogPost {
  // Parse YAML frontmatter
  const { data, content } = matter(markdownContent);

  // Validate required fields
  if (!data.title || !data.date) {
    throw new Error('Blog post must have title and date in frontmatter');
  }

  // Convert markdown to HTML
  const html = marked(content) as string;

  return {
    metadata: data as BlogPostMetadata,
    content,
    html
  };
}

/**
 * Generate slug from filename
 */
export function generateSlug(filename: string): string {
  return filename
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Read and parse a markdown file
 */
export async function readMarkdownFile(filePath: string): Promise<BlogPost> {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Markdown file not found: ${filePath}`);
  }

  const content = await file.text();
  return parseMarkdown(content);
}
