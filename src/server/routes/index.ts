import { Router } from '../core/router.ts';
import { homeHandler } from '../handlers/home.ts';
import { aboutHandler } from '../handlers/about.ts';
import { projectsHandler } from '../handlers/projects.ts';
import { blogHandler } from '../handlers/blog.ts';

export function setupRoutes(router: Router): void {
  // Register all page routes
  router.addRoute('/', homeHandler);
  router.addRoute('/home', homeHandler);
  router.addRoute('/about', aboutHandler);
  router.addRoute('/projects', projectsHandler);
  router.addRoute('/blog', blogHandler);
}
