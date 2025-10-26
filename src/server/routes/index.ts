import { Router } from '../core/router.ts';
import { shellHandler } from '../handlers/shell.ts';
import { createApiHandler, createBulkPagesHandler } from '../handlers/api.ts';
import { blogListHandler, createBlogPostHandler } from '../handlers/blog.ts';

export function setupRoutes(router: Router): void {
  router.addRoute('/', shellHandler);
  router.addRoute('/home', shellHandler);
  router.addRoute('/about', shellHandler);
  router.addRoute('/blog', shellHandler);
  router.addRoute('/blog/:slug', shellHandler);
  router.addRoute('/projects', shellHandler);

  //fetches content fragments
  router.addRoute('/api/page', createApiHandler);

  // Bulk pages endpoint - load all 4 tabs at once for instant switching
  router.addRoute('/api/pages', createBulkPagesHandler);

  // Blog API routes
  router.addRoute('/api/blog/list', blogListHandler);
  router.addRoute('/api/blog/:slug', createBlogPostHandler);
}
