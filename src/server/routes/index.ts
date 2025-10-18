import { Router } from '../core/router.ts';
import { homeHandler } from '../handlers/home.ts';
import { aboutHandler } from '../handlers/about.ts';
import { blogHandler } from '../handlers/blog.ts';
import { projectsHandler } from '../handlers/projects.ts';

export function setupRoutes(router: Router): void {
  //routes
  router.addRoute('/', homeHandler);
  router.addRoute('/home', homeHandler);
  router.addRoute('/about', aboutHandler);
  router.addRoute('/blog', blogHandler);
  router.addRoute('/projects', projectsHandler);
}
