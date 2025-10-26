import { NotFoundError, ServerError, createErrorResponse } from './errors.ts';

type RouteHandler = (() => Promise<Response>) | ((url: URL, params?: Record<string, string>) => () => Promise<Response>);

export interface Route {
  path: string;
  handler: RouteHandler;
  pattern?: RegExp;
  paramNames?: string[];
}

export class Router {
  private routes: Route[] = [];

  addRoute(path: string, handler: RouteHandler) {
    // Normalize path - ensure it starts with / and doesn't end with / (except root)
    const normalizedPath = path === '/' ? '/' : path.replace(/\/$/, '');

    // Check if path contains parameters (e.g., /blog/:slug)
    const paramPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const paramNames: string[] = [];
    let match;

    while ((match = paramPattern.exec(normalizedPath)) !== null) {
      paramNames.push(match[1]);
    }

    // If path has parameters, create a regex pattern
    if (paramNames.length > 0) {
      const regexPattern = normalizedPath.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '([^/]+)');
      const pattern = new RegExp(`^${regexPattern}$`);
      this.routes.push({ path: normalizedPath, handler, pattern, paramNames });
    } else {
      this.routes.push({ path: normalizedPath, handler });
    }
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
        // Try exact match first
        if (route.path === normalizedPathname) {
          // Check if handler needs URL (has parameter)
          const handler = route.handler;
          if (handler.length > 0) {
            // Handler expects URL, call it with URL to get the actual handler
            const urlHandler = (handler as (url: URL, params?: Record<string, string>) => () => Promise<Response>)(url);
            return await urlHandler();
          } else {
            // Simple handler, call directly
            return await (handler as () => Promise<Response>)();
          }
        }

        // Try pattern match for parameterized routes
        if (route.pattern && route.paramNames) {
          const match = normalizedPathname.match(route.pattern);
          if (match) {
            // Extract parameters
            const params: Record<string, string> = {};
            route.paramNames.forEach((name, index) => {
              params[name] = decodeURIComponent(match[index + 1]);
            });

            // Call handler with URL and params
            const handler = route.handler;
            if (handler.length > 0) {
              const urlHandler = (handler as (url: URL, params?: Record<string, string>) => () => Promise<Response>)(url, params);
              return await urlHandler();
            } else {
              return await (handler as () => Promise<Response>)();
            }
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
