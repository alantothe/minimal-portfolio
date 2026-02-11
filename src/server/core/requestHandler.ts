import { Router } from './router.ts';
import { StaticHandler } from './staticHandler.ts';

/**
 * Main request handler that orchestrates static file serving and routing
 */
export class RequestHandler {
  private staticHandler: StaticHandler;
  private router: Router;

  constructor(router: Router) {
    this.router = router;
    this.staticHandler = new StaticHandler();
  }

  /**
   * Main request handler function
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle static assets first
    if (this.staticHandler.isStaticRequest(url.pathname)) {
      return await this.staticHandler.handleStaticRequest(url);
    }

    // Handle API routes
    return await this.router.handleRequest(url);
  }
}
