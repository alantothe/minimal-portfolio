/**
 * Blog API handlers for listing posts and fetching individual posts
 */

import { readMarkdownFile, generateSlug } from '../services/markdown.ts';
import type { BlogPostMetadata } from '../services/markdown.ts';
import { readdirSync } from 'fs';
import { join } from 'path';

const BLOG_CONTENT_DIR = './src/content/blog';

export interface BlogPostSummary {
  slug: string;
  title: string;
  date: string;
  excerpt?: string;
}

/**
 * Get all blog posts with metadata
 */
async function getAllBlogPosts(): Promise<BlogPostSummary[]> {
  try {
    const files = readdirSync(BLOG_CONTENT_DIR).filter(file => file.endsWith('.md'));

    const posts = await Promise.all(
      files.map(async (filename) => {
        const filePath = join(BLOG_CONTENT_DIR, filename);
        const post = await readMarkdownFile(filePath);
        const slug = generateSlug(filename);

        return {
          slug,
          title: post.metadata.title,
          date: post.metadata.date,
          excerpt: post.metadata.excerpt
        };
      })
    );

    // Sort by date (newest first)
    posts.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });

    return posts;
  } catch (error) {
    console.error('Error reading blog posts:', error);
    return [];
  }
}

/**
 * Get a single blog post by slug
 */
async function getBlogPostBySlug(slug: string) {
  try {
    const files = readdirSync(BLOG_CONTENT_DIR).filter(file => file.endsWith('.md'));

    for (const filename of files) {
      const fileSlug = generateSlug(filename);
      if (fileSlug === slug) {
        const filePath = join(BLOG_CONTENT_DIR, filename);
        const post = await readMarkdownFile(filePath);

        return {
          slug: fileSlug,
          metadata: post.metadata,
          html: post.html
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error reading blog post:', error);
    return null;
  }
}

/**
 * Handler for /api/blog/list - returns list of all blog posts
 */
export async function blogListHandler(): Promise<Response> {
  try {
    const posts = await getAllBlogPosts();

    return new Response(
      JSON.stringify({ posts }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('Error in blog list handler:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load blog posts' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handler for /api/blog/:slug - returns single blog post
 */
export function createBlogPostHandler(url: URL, params?: Record<string, string>) {
  return async (): Promise<Response> => {
    try {
      const slug = params?.slug;

      if (!slug) {
        return new Response(
          JSON.stringify({ error: 'Slug parameter is required' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const post = await getBlogPostBySlug(slug);

      if (!post) {
        return new Response(
          JSON.stringify({ error: 'Blog post not found' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Wrap HTML content with markdown-content class for styling
      const wrappedHtml = `<div class="markdown-content">${post.html}</div>`;

      return new Response(
        JSON.stringify({ ...post, html: wrappedHtml }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        }
      );
    } catch (error) {
      console.error('Error in blog post handler:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}
