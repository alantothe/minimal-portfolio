/**
 * SSR shell handler - injects page content into the HTML before serving
 * Crawlers see real content instead of empty divs
 * The SPA router still takes over for client-side navigation after initial load
 */

import { readTextFile } from '../core/file';
import { loadPageContent } from './api';
import { getBlogPostBySlug } from './blog';
import { getProjectBySlug } from './projects';
import { createErrorResponse, NotFoundError } from '../core/errors';

export function createShellHandler(url: URL, params?: Record<string, string>) {
  return async (): Promise<Response> => {
    try {
      let html = await readTextFile('./src/pages/shell.html');
      const pathname = url.pathname;

      let pageContent = '';
      let title = 'Portfolio';
      let description = '';
      let containerId = 'home-page';

      if (params?.slug && pathname.startsWith('/blog/')) {
        // Blog post route
        const post = await getBlogPostBySlug(params.slug);
        if (post) {
          const wrappedHtml = `<div class="markdown-content">${post.html}</div>`;
          pageContent = `<article class="blog-post"><a href="/blog" class="back-to-blog back-link">&larr; Back to Blog</a><div class="blog-post-content">${wrappedHtml}</div></article>`;
          title = `${post.metadata.title} - Blog - Portfolio`;
          description = post.metadata.excerpt || '';
          containerId = 'blog-post-page';
        } else {
          return createErrorResponse(new NotFoundError('Blog post not found'));
        }
      } else if (params?.slug && pathname.startsWith('/projects/')) {
        // Project route
        const project = await getProjectBySlug(params.slug);
        if (project) {
          const wrappedHtml = `<div class="markdown-content">${project.html}</div>`;
          pageContent = `<article class="project"><a href="/projects" class="back-to-projects back-link">&larr; Back to Projects</a><div class="project-content">${wrappedHtml}</div></article>`;
          title = `${project.metadata.title} - Portfolio`;
          description = project.metadata.description || '';
          containerId = 'project-page';
        } else {
          return createErrorResponse(new NotFoundError('Project not found'));
        }
      } else {
        // Regular page (home, about, blog listing, projects listing)
        let pageName = 'home';
        if (pathname === '/about') pageName = 'about';
        else if (pathname === '/blog') pageName = 'blog';
        else if (pathname === '/projects') pageName = 'projects';

        try {
          const pageData = await loadPageContent(pageName);
          pageContent = pageData.content;
          title = pageData.title;
          containerId = `${pageName}-page`;
        } catch (error) {
          console.error('Error loading page content for SSR:', error);
        }
      }

      // Inject SSR content into shell
      if (pageContent) {
        // Remove default active from home-page
        html = html.replace(
          'id="home-page" class="page-container active"',
          'id="home-page" class="page-container"'
        );

        // Set active and inject content on target container
        html = html.replace(
          `id="${containerId}" class="page-container"`,
          `id="${containerId}" class="page-container active"`
        );
        html = html.replace(
          `<div id="${containerId}" class="page-container active"></div>`,
          `<div id="${containerId}" class="page-container active">${pageContent}</div>`
        );
      }

      // Set title
      html = html.replace('<title>Portfolio</title>', `<title>${title}</title>`);

      // Add meta description for blog posts and projects
      if (description) {
        const safeDesc = description.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        html = html.replace('</head>', `    <meta name="description" content="${safeDesc}">\n</head>`);
      }

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error('Error in shell handler:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  };
}
