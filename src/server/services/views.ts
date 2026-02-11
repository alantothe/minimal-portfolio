/**
 * Blog view tracking service
 * Handles reading, updating, and calculating blog post view counts
 */

import { readdirSync } from 'fs';
import { join } from 'path';

const VIEWS_FILE = './src/data/blog-views.json';
const BLOG_CONTENT_DIR = './src/content/blog';

interface ViewCounts {
  [slug: string]: number;
}

/**
 * Read all view counts from the views file
 */
export async function getViewCounts(): Promise<ViewCounts> {
  try {
    const file = Bun.file(VIEWS_FILE);
    if (!(await file.exists())) {
      return {};
    }
    const content = await file.text();
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading view counts:', error);
    return {};
  }
}

/**
 * Get view count for a specific post
 */
export async function getPostViews(slug: string): Promise<number> {
  const views = await getViewCounts();
  return views[slug] || 0;
}

/**
 * Increment view count for a post
 */
export async function incrementPostView(slug: string): Promise<number> {
  try {
    const views = await getViewCounts();
    views[slug] = (views[slug] || 0) + 1;

    // Write back to file
    const file = Bun.file(VIEWS_FILE);
    await Bun.write(file, JSON.stringify(views, null, 2));

    return views[slug];
  } catch (error) {
    console.error('Error incrementing view count:', error);
    return 0;
  }
}

/**
 * Get total views across all posts
 */
export async function getTotalViews(): Promise<number> {
  try {
    const views = await getViewCounts();
    return Object.values(views).reduce((sum, count) => sum + count, 0);
  } catch (error) {
    console.error('Error calculating total views:', error);
    return 0;
  }
}

/**
 * Sync view data with actual blog posts
 * Removes view entries for posts that no longer exist
 * Called on server startup to keep views.json in sync
 */
export async function syncViewsWithBlogPosts(): Promise<void> {
  try {
    // Get list of actual blog files
    const files = readdirSync(BLOG_CONTENT_DIR).filter(file => file.endsWith('.md'));

    // Generate slugs for existing posts
    const existingSlugs = new Set(
      files.map(file => {
        // Convert filename to slug (same logic as generateSlug in markdown service)
        return file
          .replace(/\.md$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      })
    );

    // Get current view counts
    const currentViews = await getViewCounts();

    // Find orphaned entries
    const orphanedSlugs = Object.keys(currentViews).filter(slug => !existingSlugs.has(slug));

    if (orphanedSlugs.length === 0) {
      // No cleanup needed
      return;
    }

    // Remove orphaned entries
    const cleanedViews: ViewCounts = {};
    Object.entries(currentViews).forEach(([slug, count]) => {
      if (existingSlugs.has(slug)) {
        cleanedViews[slug] = count;
      }
    });

    // Write cleaned views back to file
    const file = Bun.file(VIEWS_FILE);
    await Bun.write(file, JSON.stringify(cleanedViews, null, 2));

    console.log(
      `[View Sync] Cleaned up orphaned view entries: ${orphanedSlugs.join(', ')}`
    );
  } catch (error) {
    console.error('[View Sync] Error syncing views with blog posts:', error);
  }
}

