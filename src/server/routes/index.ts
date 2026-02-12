import { Router } from '../core/router';
import { createShellHandler } from '../handlers/shell';
import { createApiHandler, createBulkPagesHandler } from '../handlers/api';
import { blogListHandler, createBlogPostHandler } from '../handlers/blog';
import { projectsListHandler, createProjectHandler } from '../handlers/projects';

export function setupRoutes(router: Router): void {
  // SSR shell routes - content is injected server-side before serving
  router.addRoute('/', createShellHandler);
  router.addRoute('/home', createShellHandler);
  router.addRoute('/about', createShellHandler);
  router.addRoute('/blog', createShellHandler);
  router.addRoute('/blog/:slug', createShellHandler);
  router.addRoute('/projects', createShellHandler);
  router.addRoute('/projects/:slug', createShellHandler);

  //fetches content fragments
  router.addRoute('/api/page', createApiHandler);

  // Bulk pages endpoint - load all 4 tabs at once for instant switching
  router.addRoute('/api/pages', createBulkPagesHandler);

  // Blog API routes
  router.addRoute('/api/blog/list', blogListHandler);
  router.addRoute('/api/blog/:slug', createBlogPostHandler);

  // Projects API routes
  router.addRoute('/api/projects/list', projectsListHandler);
  router.addRoute('/api/projects/:slug', createProjectHandler);
}
