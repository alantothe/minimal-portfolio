import { NotFoundError, ServerError, createErrorResponse } from './errors.ts';

type RouteHandler = (() => Promise<Response>) | ((url: URL) => () => Promise<Response>);

export interface Route {
  path: string;
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  addRoute(path: string, handler: RouteHandler) {
    // Normalize path - ensure it starts with / and doesn't end with / (except root)
    const normalizedPath = path === '/' ? '/' : path.replace(/\/$/, '');
    this.routes.push({ path: normalizedPath, handler });
  }

  /**
   * Normalize a pathname for matching
   */
  private normalizePathname(pathname: string): string {
    // Remove trailing slash except for root
    return pathname === '/' ? '/' : pathname.replace(/\/$/, '');
  }

  async handleRequest(url: URL): Promise<Response> {
    const normalizedPathname = this.normalizePathname(url.pathname);

    try {
      // Find matching route
      for (const route of this.routes) {
        if (route.path === normalizedPathname) {
          // Check if handler needs URL (has parameter)
          const handler = route.handler;
          if (handler.length > 0) {
            // Handler expects URL, call it with URL to get the actual handler
            const urlHandler = (handler as (url: URL) => () => Promise<Response>)(url);
            return await urlHandler();
          } else {
            // Simple handler, call directly
            return await (handler as () => Promise<Response>)();
          }
        }
      }

      // Handle 404
      throw new NotFoundError('The page you\'re looking for doesn\'t exist.');
    } catch (error) {
      if (error instanceof NotFoundError) {
        return createErrorResponse(error);
      }

      // Handle unexpected errors
      console.error('Unexpected error in router:', error);
      const serverError = new ServerError('An unexpected error occurred');
      return createErrorResponse(serverError);
    }
  }
}
