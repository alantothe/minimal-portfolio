/**
 * api endpoint to fetch page content as json for spa navigation
 * returns only the main content and metadata, not full html
 */

interface PageData {
  content: string;
  title: string;
  activePage: string;
  pageCSS: string;
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

  const content = await pageFile.text();

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
