import { Router } from '../core/router.ts';
import { homeHandler } from '../handlers/home.ts';

export function setupRoutes(router: Router): void {
  //routes
  router.addRoute('/', homeHandler);
  router.addRoute('/home', homeHandler);
}
