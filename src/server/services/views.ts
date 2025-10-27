/**
 * Blog view tracking service
 * Handles reading, updating, and calculating blog post view counts
 */

const VIEWS_FILE = './src/data/blog-views.json';

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

