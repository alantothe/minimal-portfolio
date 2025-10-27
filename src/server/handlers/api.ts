/**
 * api endpoint to fetch page content as json for spa navigation
 * returns only the main content and metadata, not full html
 */

import { getMonthlyCommitCount } from '../services/github.ts';

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
 */
async function loadPageData(pageName: string): Promise<any> {
  // Only home page has data config for now
  if (pageName === 'home') {
    try {
      const configFile = Bun.file('./src/pages/home/data/config.ts');
      const configCode = await configFile.text();

      // Use eval to execute the module code and extract the export
      // Create a module-like context
      const moduleContext = { exports: {}, siteConfig: null };
      const wrappedCode = configCode.replace('export const siteConfig', 'siteConfig');

      // Execute in a function scope to capture siteConfig
      const func = new Function('siteConfig', wrappedCode + '\nreturn siteConfig;');
      const siteConfig = func();

      // Fetch real-time GitHub commit count
      const githubCommits = await getMonthlyCommitCount();

      // Count blog posts
      const blogPostCount = await countBlogPosts();

      // Merge with config data, using real GitHub data if available (fallback to config value)
      return {
        ...siteConfig,
        metrics: {
          ...siteConfig.metrics,
          githubCommits: githubCommits > 0 ? githubCommits : siteConfig.metrics.githubCommits,
          blogPostCount: blogPostCount
        }
      };
    } catch (error) {
      console.error('Error loading page data:', error);
      return null;
    }
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
async function loadPageContent(pageName: string): Promise<PageData> {
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

  const pageFile = Bun.file(pagePath);
  if (!(await pageFile.exists())) {
    throw new Error('Page content not found');
  }

  let content = await pageFile.text();

  // Load and process page data
  const pageData = await loadPageData(pageName);
  if (pageData) {
    content = processTemplate(content, pageData);
  }

  return {
    content: content.trim(),
    title: titles[pageName] || 'Portfolio',
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

      const pageData = await loadPageContent(pageName);

      return new Response(
        JSON.stringify(pageData),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        }
      );
    } catch (error) {
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

/**
 * Bulk API endpoint that loads all 4 pages at once for instant tab switching
 */
export async function createBulkPagesHandler(): Promise<Response> {
  try {
    const pageNames = ['home', 'about', 'projects', 'blog'];
    const allPages: Record<string, any> = {};

    // Load all pages in parallel
    await Promise.all(
      pageNames.map(async (pageName) => {
        const pageData = await loadPageContent(pageName);
        allPages[pageName] = pageData;
      })
    );

    return new Response(
      JSON.stringify({ pages: allPages }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('Error in bulk pages handler:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
