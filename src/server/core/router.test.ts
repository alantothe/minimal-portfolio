import { describe, expect, test } from "bun:test";
import { RequestHandler } from "./requestHandler";
import {
  Router,
  fromResponder,
  fromUrlFactory,
  type RouteContext,
} from "./router";

function ok(body = "ok"): Response {
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}

function handlerFor(router: Router): RequestHandler {
  return new RequestHandler(router);
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://portfolio.test${path}`, init);
}

describe("route context", () => {
  test("handlers receive the request, url, and params", async () => {
    const router = new Router();
    let seen: RouteContext | null = null;

    router.addRoute("/blog/:slug", async (context) => {
      seen = context;
      return ok();
    });

    await router.handleRequest(request("/blog/hello?draft=1"));

    expect(seen!.request.method).toBe("GET");
    expect(seen!.url.pathname).toBe("/blog/hello");
    expect(seen!.url.searchParams.get("draft")).toBe("1");
    expect(seen!.params).toEqual({ slug: "hello" });
  });

  test("params are empty rather than undefined on static paths", async () => {
    const router = new Router();
    let seen: RouteContext | null = null;

    router.addRoute("/about", async (context) => {
      seen = context;
      return ok();
    });

    await router.handleRequest(request("/about"));

    expect(seen!.params).toEqual({});
  });

  test("handlers can read headers the old signature could not reach", async () => {
    // This is the point of the change: a CSRF check needs Origin, and a
    // URL-only handler has no way to see it.
    const router = new Router();
    const captured: { origin: string | null } = { origin: null };

    router.addRoute("/api/thing", async ({ request: received }) => {
      captured.origin = received.headers.get("Origin");
      return ok();
    });

    await router.handleRequest(
      request("/api/thing", { headers: { Origin: "https://portfolio.test" } })
    );

    expect(captured.origin).toBe("https://portfolio.test");
  });
});

describe("methods", () => {
  test("routes are GET and HEAD unless they say otherwise", () => {
    const router = new Router();
    router.addRoute(
      "/about",
      fromResponder(async () => ok())
    );

    expect(router.allowedMethods("/about")).toEqual(["GET", "HEAD"]);
  });

  test("a route that declares GET also answers HEAD", () => {
    const router = new Router();
    router.addRoute(
      "/about",
      fromResponder(async () => ok()),
      {
        methods: ["GET"],
      }
    );

    expect(router.allowedMethods("/about")).toContain("HEAD");
  });

  test("a route can opt in to a mutation method", async () => {
    const router = new Router();
    router.addRoute(
      "/widgets/archive",
      async ({ request: received }) => ok(received.method),
      { methods: ["POST"] }
    );

    const response = await handlerFor(router).handleRequest(
      request("/widgets/archive", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("POST");
  });

  test("a mutation route still refuses methods it did not declare", async () => {
    const router = new Router();
    router.addRoute(
      "/widgets/archive",
      fromResponder(async () => ok()),
      {
        methods: ["POST"],
      }
    );

    const response = await handlerFor(router).handleRequest(
      request("/widgets/archive")
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  test("an unknown path still refuses a write before reporting 404", async () => {
    const router = new Router();
    router.addRoute(
      "/about",
      fromResponder(async () => ok())
    );

    const response = await handlerFor(router).handleRequest(
      request("/nope", { method: "POST" })
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });

  test("OPTIONS reports what the matched route actually accepts", async () => {
    const router = new Router();
    router.addRoute(
      "/widgets/archive",
      fromResponder(async () => ok()),
      {
        methods: ["POST"],
      }
    );
    router.addRoute(
      "/about",
      fromResponder(async () => ok())
    );

    const handler = handlerFor(router);

    const mutation = await handler.handleRequest(
      request("/widgets/archive", { method: "OPTIONS" })
    );
    const page = await handler.handleRequest(
      request("/about", { method: "OPTIONS" })
    );

    expect(mutation.status).toBe(204);
    expect(mutation.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(page.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });
});

describe("adapters", () => {
  test("a url-factory handler still receives url and params", async () => {
    const router = new Router();
    router.addRoute(
      "/projects/:slug",
      fromUrlFactory(
        (url, params) => async () => ok(`${url.pathname}:${params?.slug}`)
      )
    );

    const response = await router.handleRequest(request("/projects/alpha"));

    expect(await response.text()).toBe("/projects/alpha:alpha");
  });

  test("a responder handler ignores the request entirely", async () => {
    const router = new Router();
    router.addRoute(
      "/healthz",
      fromResponder(async () => ok("alive"))
    );

    expect(await (await router.handleRequest(request("/healthz"))).text()).toBe(
      "alive"
    );
  });
});

describe("failures", () => {
  test("an unmatched path is a 404", async () => {
    const router = new Router();
    const response = await router.handleRequest(request("/missing"));

    expect(response.status).toBe(404);
  });

  test("a throwing handler becomes a 500, not a leaked stack", async () => {
    const router = new Router();
    router.addRoute("/boom", async () => {
      throw new Error("internal detail");
    });

    const errors = console.error;
    console.error = () => {};
    try {
      const response = await router.handleRequest(request("/boom"));
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("internal detail");
    } finally {
      console.error = errors;
    }
  });
});
