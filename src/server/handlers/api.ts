/**
 * api endpoint to fetch page content as json for spa navigation
 * returns only the main content and metadata, not full html
 */

import { getMonthlyCommitCount } from '../services/github';
import { getTotalViews } from '../services/views';
import { readTextFile, fileExists } from '../core/file';
import { homeConfig, aboutConfig } from '../../config/index';
import { getAllBlogPosts } from './blog';
import { getAllProjects } from './projects';
import {
  CollectionPageNotFoundError,
  renderBlogCollection,
  renderProjectCollection,
} from '../services/collectionPages';
import {
  createSeoMetadata,
  type SeoPageInput,
} from '../services/seo';

interface PageData {
  content: string;
  title: string;
  activePage: string;
  pageCSS: string;
}

/**
 * Count blog posts in the blog directory
 */
async function countBlogPosts(): Promise<number> {
  try {
    const blogDir = './src/content/blog';
    const { readdir } = await import('fs/promises');

    const files = await readdir(blogDir);
    const mdFiles = files.filter(file => file.endsWith('.md'));

    return mdFiles.length;
  } catch (error) {
    console.error('Error counting blog posts:', error);
    return 0;
  }
}

/**
 * load page-specific data configuration
 * Uses static imports instead of dynamic imports for Node.js/Vercel compatibility
 */
async function loadPageData(pageName: string): Promise<any> {
  if (pageName === 'home') {
    try {
      // Fetch real-time GitHub commit count
      const githubCommits = await getMonthlyCommitCount();

      // Count blog posts
      const blogPostCount = await countBlogPosts();

      // Get total blog views
      const totalViews = await getTotalViews();

      // Merge with config data, using real GitHub data if available (fallback to config value)
      return {
        ...homeConfig,
        metrics: {
          ...homeConfig.metrics,
          githubCommits: githubCommits > 0 ? githubCommits : homeConfig.metrics.githubCommits,
          blogPostCount: blogPostCount,
          totalViews: totalViews
        }
      };
    } catch (error) {
      console.error('Error loading page data:', error);
      return null;
    }
  } else if (pageName === 'about') {
    return aboutConfig;
  }
  return null;
}

/**
 * Replace template placeholders with actual data
 */
function processTemplate(html: string, data: any): string {
  if (!data) return html;

  // Simple template replacement: {{key.path}}
  return html.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = data;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) return match; // Keep original if not found
    }

    return String(value);
  });
}

/**
 * load page content from content fragment files
 */
export async function loadPageContent(
  pageName: string,
  pageNumber: number = 1,
): Promise<PageData> {
  const pageMap: Record<string, string> = {
    'home': './src/pages/home/content.html',
    'about': './src/pages/about/content.html',
    'blog': './src/pages/blog/content.html',
    'projects': './src/pages/projects/content.html'
  };

  const titles: Record<string, string> = {
    home: 'Home - Portfolio',
    about: 'About - Portfolio',
    projects: 'Projects - Portfolio',
    blog: 'Blog - Portfolio',
  };

  const cssMap: Record<string, string> = {
    home: '/pages/home/styles.css',
    about: '/pages/about/styles.css',
    projects: '/pages/projects/styles.css',
    blog: '/pages/blog/styles.css',
  };

  const pagePath = pageMap[pageName];
  if (!pagePath) {
    throw new Error('Page not found');
  }

  if (!(await fileExists(pagePath))) {
    throw new Error('Page content not found');
  }

  let content = await readTextFile(pagePath);

  // Load and process page data
  const pageData = await loadPageData(pageName);
  if (pageData) {
    content = processTemplate(content, pageData);
  }

  if (pageName === 'blog') {
    const collection = renderBlogCollection(
      await getAllBlogPosts(),
      pageNumber,
    );
    content = content
      .replace('{{collection.items}}', collection.itemsHtml)
      .replace('{{collection.pagination}}', collection.paginationHtml);
  } else if (pageName === 'projects') {
    const collection = renderProjectCollection(
      await getAllProjects(),
      pageNumber,
    );
    content = content
      .replace('{{collection.items}}', collection.itemsHtml)
      .replace('{{collection.pagination}}', collection.paginationHtml);
  }

  return {
    content: content.trim(),
    title: pageNumber > 1
      ? `${titles[pageName] || 'Portfolio'} - Page ${pageNumber}`
      : titles[pageName] || 'Portfolio',
    activePage: pageName,
    pageCSS: cssMap[pageName] || ''
  };
}

/**
 * api handler that will be wrapped to access URL query params
 * this needs to be called with URL access
 */
export function createApiHandler(url: URL) {
  return async (): Promise<Response> => {
    try {
      const pageName = url.searchParams.get('name');

      // Validate page name
      const validPages = ['home', 'about', 'projects', 'blog'];
      if (!pageName || !validPages.includes(pageName)) {
        return new Response(
          JSON.stringify({ error: 'Invalid or missing page name' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const pageNumber = Number(url.searchParams.get('page') || 1);
      const pageData = await loadPageContent(pageName, pageNumber);
      const pageKind = pageName as 'home' | 'about' | 'projects' | 'blog';
      const seoInput: SeoPageInput = pageKind === 'blog' || pageKind === 'projects'
        ? { kind: pageKind, page: pageNumber }
        : { kind: pageKind };
      const seo = createSeoMetadata(seoInput, url);

      return new Response(
        JSON.stringify({ ...pageData, seo }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        }
      );
    } catch (error) {
      if (error instanceof CollectionPageNotFoundError) {
        return new Response(
          JSON.stringify({ error: 'Collection page not found' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      console.error('Error in page API handler:', error);
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
