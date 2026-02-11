import { Router } from '../core/router';
import { shellHandler } from '../handlers/shell';
import { createApiHandler, createBulkPagesHandler } from '../handlers/api';
import { blogListHandler, createBlogPostHandler } from '../handlers/blog';
import { projectsListHandler, createProjectHandler } from '../handlers/projects';

export function setupRoutes(router: Router): void {
  router.addRoute('/', shellHandler);
  router.addRoute('/home', shellHandler);
  router.addRoute('/about', shellHandler);
  router.addRoute('/blog', shellHandler);
  router.addRoute('/blog/:slug', shellHandler);
  router.addRoute('/projects', shellHandler);
  router.addRoute('/projects/:slug', shellHandler);

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
