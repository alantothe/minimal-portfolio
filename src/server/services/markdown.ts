/**
 * Markdown parsing service with YAML frontmatter and syntax highlighting
 */

import { marked, Renderer } from 'marked';
import matter from 'gray-matter';
import hljs from 'highlight.js';
import { readTextFile, fileExists } from '../core/file';

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
 * Configure marked with syntax highlighting via custom renderer
 */
const renderer = new Renderer();
renderer.code = function({ text, lang }: { text: string; lang?: string }) {
  let highlighted: string;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } catch {
      highlighted = hljs.highlightAuto(text).value;
    }
  } else {
    highlighted = hljs.highlightAuto(text).value;
  }
  return `<pre><code class="hljs language-${lang || ''}">${highlighted}</code></pre>`;
};

marked.use({ renderer });

/**
 * Transform image URLs from placeholder paths to Cloudinary URLs
 * Converts /images/{slug}/{name} to https://res.cloudinary.com/dz18m79a1/image/upload/{slug}/{name}
 */
function transformImageUrls(html: string): string {
  return html.replace(
    /src="\/images\/([^\/]+)\/([^"]+)"/g,
    (match, slug, imageName) => {
      const cloudinaryUrl = `https://res.cloudinary.com/dz18m79a1/image/upload/${slug}/${imageName}`;
      return `src="${cloudinaryUrl}"`;
    }
  );
}


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
  let html = marked(content) as string;

  // Transform placeholder image URLs to Cloudinary URLs
  html = transformImageUrls(html);

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
  if (!(await fileExists(filePath))) {
    throw new Error(`Markdown file not found: ${filePath}`);
  }

  const content = await readTextFile(filePath);
  return parseMarkdown(content);
}
