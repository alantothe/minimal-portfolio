import { NotFoundError, ServerError, createErrorResponse } from "./errors";

/**
 * Everything a handler is allowed to know about the request.
 *
 * Handlers used to receive only a `URL`, which was enough while every route was
 * a GET. The Owner workspace needs mutations, and a mutation cannot be made safe
 * without the method, the `Origin` header, and the request body — a CSRF check
 * that cannot read `Origin` is not a CSRF check. Passing the whole `Request`
 * once, here, avoids threading those through later one at a time.
 */
export interface RouteContext {
  request: Request;
  url: URL;
  /** Empty for routes without `:parameters`. */
  params: Record<string, string>;
}

export type RouteHandler = (context: RouteContext) => Promise<Response>;

/**
 * Routes are GET/HEAD unless they say otherwise. Owner mutations opt in
 * explicitly, so a route can never accept a write by forgetting to declare
 * what it accepts.
 */
export const DEFAULT_METHODS = ["GET", "HEAD"] as const;

export interface RouteOptions {
  methods?: string[];
}

export interface Route {
  path: string;
  handler: RouteHandler;
  methods: string[];
  pattern?: RegExp;
  paramNames?: string[];
}

/**
 * Adapts a handler written against the older `(url, params) => () => Response`
 * shape. It exists so this change stays a routing change: handler internals are
 * untouched, and the public responses are byte-identical.
 */
export function fromUrlFactory(
  factory: (
    url: URL,
    params?: Record<string, string>
  ) => () => Promise<Response>
): RouteHandler {
  return ({ url, params }) => factory(url, params)();
}

/** Adapts a handler that needs nothing from the request at all. */
export function fromResponder(
  responder: () => Promise<Response>
): RouteHandler {
  return () => responder();
}

export class Router {
  private routes: Route[] = [];

  addRoute(path: string, handler: RouteHandler, options: RouteOptions = {}) {
    // Normalize path - ensure it starts with / and doesn't end with / (except root)
    const normalizedPath = path === "/" ? "/" : path.replace(/\/$/, "");
    const methods = normalizeMethods(options.methods ?? [...DEFAULT_METHODS]);

    // Check if path contains parameters (e.g., /blog/:slug)
    const paramPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const paramNames: string[] = [];
    let match;

    while ((match = paramPattern.exec(normalizedPath)) !== null) {
      const paramName = match[1];
      if (paramName) {
        paramNames.push(paramName);
      }
    }

    // If path has parameters, create a regex pattern
    if (paramNames.length > 0) {
      const regexPattern = normalizedPath.replace(
        /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
        "([^/]+)"
      );
      const pattern = new RegExp(`^${regexPattern}$`);
      this.routes.push({
        path: normalizedPath,
        handler,
        methods,
        pattern,
        paramNames,
      });
    } else {
      this.routes.push({ path: normalizedPath, handler, methods });
    }
  }

  /**
   * Normalize a pathname for matching
   */
  private normalizePathname(pathname: string): string {
    // Remove trailing slash except for root
    return pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  }

  private match(
    pathname: string
  ): { route: Route; params: Record<string, string> } | null {
    const normalizedPathname = this.normalizePathname(pathname);

    for (const route of this.routes) {
      if (route.path === normalizedPathname) {
        return { route, params: {} };
      }

      if (route.pattern && route.paramNames) {
        const matched = normalizedPathname.match(route.pattern);
        if (matched) {
          const params: Record<string, string> = {};
          route.paramNames.forEach((name, index) => {
            const value = matched[index + 1];
            if (value !== undefined) {
              params[name] = decodeURIComponent(value);
            }
          });
          return { route, params };
        }
      }
    }

    return null;
  }

  /**
   * Which methods this path accepts.
   *
   * An unmatched path reports the default set rather than nothing, so an
   * unsupported method is still refused with 405 before the 404 body is built.
   */
  allowedMethods(pathname: string): string[] {
    return this.match(pathname)?.route.methods ?? [...DEFAULT_METHODS];
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      const matched = this.match(url.pathname);

      if (matched) {
        return await matched.route.handler({
          request,
          url,
          params: matched.params,
        });
      }

      // Handle 404
      throw new NotFoundError("The page you're looking for doesn't exist.");
    } catch (error) {
      if (error instanceof NotFoundError) {
        return createErrorResponse(error);
      }

      // Handle unexpected errors
      console.error("Unexpected error in router:", error);
      const serverError = new ServerError("An unexpected error occurred");
      return createErrorResponse(serverError);
    }
  }
}

function normalizeMethods(methods: string[]): string[] {
  const upper = methods.map((method) => method.toUpperCase());

  // A route that answers GET answers HEAD; the request pipeline strips the body.
  if (upper.includes("GET") && !upper.includes("HEAD")) {
    upper.push("HEAD");
  }

  return upper;
}
