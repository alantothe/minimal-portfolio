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
import { CollectionPageNotFoundError } from '../services/collectionPages';
import {
  createSeoMetadata,
  renderSeoHead,
  type SeoPageInput,
} from '../services/seo';

export function createShellHandler(url: URL, params?: Record<string, string>) {
  return async (): Promise<Response> => {
    try {
      if (url.pathname === '/home') {
        return new Response(null, {
          status: 308,
          headers: { Location: '/' },
        });
      }

      let html = await readTextFile('./src/pages/shell.html');
      const pathname = url.pathname;

      let pageContent = '';
      let containerId = 'home-page';
      let seoInput: SeoPageInput = { kind: 'home' };

      if (params?.slug && pathname.startsWith('/blog/')) {
        // Blog post route
        const post = await getBlogPostBySlug(params.slug);
        if (post) {
          const wrappedHtml = `<div class="markdown-content">${post.html}</div>`;
          pageContent = `<article class="blog-post"><a href="/blog" class="back-to-blog back-link">&larr; Back to Blog</a><div class="blog-post-content">${wrappedHtml}</div></article>`;
          containerId = 'blog-post-page';
          seoInput = {
            kind: 'blog-post',
            slug: post.slug,
            title: post.metadata.title,
            description: post.metadata.excerpt || '',
            date: post.metadata.date,
          };
        } else {
          return createErrorResponse(new NotFoundError('Blog post not found'));
        }
      } else if (params?.slug && pathname.startsWith('/projects/')) {
        // Project route
        const project = await getProjectBySlug(params.slug);
        if (project) {
          const wrappedHtml = `<div class="markdown-content">${project.html}</div>`;
          pageContent = `<article class="project"><a href="/projects" class="back-to-projects back-link">&larr; Back to Projects</a><div class="project-content">${wrappedHtml}</div></article>`;
          containerId = 'project-page';
          seoInput = {
            kind: 'project',
            slug: project.slug,
            title: project.metadata.title,
            description: project.metadata.description || '',
          };
        } else {
          return createErrorResponse(new NotFoundError('Project not found'));
        }
      } else {
        // Regular page (home, about, blog listing, projects listing)
        let pageName: 'home' | 'about' | 'blog' | 'projects' = 'home';
        if (pathname === '/about') pageName = 'about';
        else if (pathname === '/blog') pageName = 'blog';
        else if (pathname === '/projects') pageName = 'projects';

        try {
          const pageNumber = Number(url.searchParams.get('page') || 1);
          const pageData = await loadPageContent(pageName, pageNumber);
          pageContent = pageData.content;
          containerId = `${pageName}-page`;
          seoInput = pageName === 'blog' || pageName === 'projects'
            ? { kind: pageName, page: pageNumber }
            : { kind: pageName };
        } catch (error) {
          if (error instanceof CollectionPageNotFoundError) {
            return createErrorResponse(new NotFoundError('Collection page not found'));
          }
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

      const seo = createSeoMetadata(seoInput, url);
      html = html.replace('<title>Portfolio</title>', renderSeoHead(seo));

      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      console.error('Error in shell handler:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  };
}
