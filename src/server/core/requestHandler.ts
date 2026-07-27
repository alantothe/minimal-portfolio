import { Router } from './router';
import { StaticHandler } from './staticHandler';

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
    const allowedMethods = 'GET, HEAD, OPTIONS';
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { Allow: allowedMethods },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: allowedMethods },
      });
    }

    const url = new URL(request.url);
    let response: Response;

    // Handle static assets first
    if (this.staticHandler.isStaticRequest(url.pathname)) {
      response = await this.staticHandler.handleStaticRequest(url);
    } else {
      // Handle API routes
      response = await this.router.handleRequest(url);
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  }
}
