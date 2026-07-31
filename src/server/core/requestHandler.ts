import { DEFAULT_METHODS, Router } from "./router";
import { StaticHandler } from "./staticHandler";
import { gzipSync } from "node:zlib";

async function compressResponse(
  request: Request,
  response: Response
): Promise<Response> {
  const acceptsGzip = /\bgzip\b/i.test(
    request.headers.get("Accept-Encoding") || ""
  );
  const contentType = response.headers.get("Content-Type") || "";
  const isCompressible =
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("javascript") ||
    contentType.includes("xml");

  if (
    !acceptsGzip ||
    !isCompressible ||
    !response.body ||
    response.headers.has("Content-Encoding") ||
    response.status < 200 ||
    response.status === 204 ||
    response.status === 304
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");

  const compressed = Uint8Array.from(
    gzipSync(new Uint8Array(await response.arrayBuffer()))
  );

  return new Response(compressed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    const url = new URL(request.url);
    const isStatic = this.staticHandler.isStaticRequest(url.pathname);

    // Static assets are always read-only; routes declare what they accept, so
    // an Owner mutation route can later allow POST without widening every path.
    const methods = isStatic
      ? [...DEFAULT_METHODS]
      : this.router.allowedMethods(url.pathname);
    const allowedMethods = [...methods, "OPTIONS"].join(", ");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { Allow: allowedMethods },
      });
    }

    if (!methods.includes(request.method)) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: allowedMethods },
      });
    }

    let response: Response;

    // Handle static assets first
    if (isStatic) {
      response = await this.staticHandler.handleStaticRequest(request);
    } else {
      // Handle API routes
      response = await this.router.handleRequest(request);
    }

    response = await compressResponse(request, response);

    if (request.method === "HEAD") {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  }
}
