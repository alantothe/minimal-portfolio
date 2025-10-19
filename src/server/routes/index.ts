import { Router } from '../core/router.ts';
import { shellHandler } from '../handlers/shell.ts';
import { createApiHandler } from '../handlers/api.ts';

export function setupRoutes(router: Router): void {
  router.addRoute('/', shellHandler);
  router.addRoute('/home', shellHandler);
  router.addRoute('/about', shellHandler);
  router.addRoute('/blog', shellHandler);
  router.addRoute('/projects', shellHandler);

  //fetches content fragments
  router.addRoute('/api/page', createApiHandler);
}
