import { NotFoundError, ServerError, createErrorResponse } from './errors.ts';
import type { Route } from './types.ts';

export class Router {
  private routes: Route[] = [];

  addRoute(path: string, handler: () => Promise<Response>) {
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
          return await route.handler();
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
