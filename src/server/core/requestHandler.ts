import { Router } from './router';
import { StaticHandler } from './staticHandler';
import { gzipSync } from 'node:zlib';

async function compressResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  const acceptsGzip = /\bgzip\b/i.test(
    request.headers.get('Accept-Encoding') || '',
  );
  const contentType = response.headers.get('Content-Type') || '';
  const isCompressible = contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('javascript')
    || contentType.includes('xml');

  if (
    !acceptsGzip
    || !isCompressible
    || !response.body
    || response.headers.has('Content-Encoding')
    || response.status < 200
    || response.status === 204
    || response.status === 304
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  const vary = headers.get('Vary');
  headers.set(
    'Vary',
    vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding',
  );
  headers.set('Content-Encoding', 'gzip');
  headers.delete('Content-Length');

  const compressed = Uint8Array.from(
    gzipSync(new Uint8Array(await response.arrayBuffer())),
  );

  return new Response(
    compressed,
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

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
      response = await this.staticHandler.handleStaticRequest(request);
    } else {
      // Handle API routes
      response = await this.router.handleRequest(url);
    }

    response = await compressResponse(request, response);

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
