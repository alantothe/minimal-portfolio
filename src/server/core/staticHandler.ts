import { serverConfig } from './config';
import { StaticFileError, ServerError, createErrorResponse } from './errors';

/**
 * Handles static file serving for CSS, JS, images, and other assets
 */
export class StaticHandler {

  /**
   * Checks if the request is for a static file
   */
  isStaticRequest(pathname: string): boolean {
    return pathname.startsWith(serverConfig.static.publicPath) ||
           pathname.startsWith(serverConfig.static.pagesPath) ||
           pathname.startsWith(serverConfig.static.layoutPath) ||
           serverConfig.static.allowedExtensions.some((ext: string) => pathname.endsWith(ext));
  }

  /**
   * Resolves the file path for a given URL pathname
   */
  private resolveFilePath(pathname: string): string {
    if (pathname.startsWith(serverConfig.static.publicPath)) {
      return `/src${pathname}`;
    }
    
    if (pathname.startsWith(serverConfig.static.pagesPath)) {
      return `/src${pathname}`;
    }
    
    if (pathname.startsWith(serverConfig.static.layoutPath)) {
      return `/src${pathname}`;
    }
    
    // Default to public directory
    return `/src${serverConfig.static.publicPath}${pathname}`;
  }

  /**
   * Handles static file requests
   */
  async handleStaticRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const filePath = this.resolveFilePath(pathname);
      const file = Bun.file(`.${filePath}`);
      
      if (await file.exists()) {
        const etag = `W/"${file.size}-${file.lastModified}"`;
        const headers = {
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          ETag: etag,
        };

        if (request.headers.get('If-None-Match') === etag) {
          return new Response(null, { status: 304, headers });
        }

        return new Response(file, { headers });
      }
      
      throw new StaticFileError(`File not found: ${pathname}`);
    } catch (error) {
      if (error instanceof StaticFileError) {
        return createErrorResponse(error);
      }
      
      console.error('Unexpected error in static handler:', error);
      const serverError = new ServerError('An unexpected error occurred while serving static file');
      return createErrorResponse(serverError);
    }
  }
}
