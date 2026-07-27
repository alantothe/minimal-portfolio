import { describe, expect, test } from "bun:test";
import { RequestHandler } from "./core/requestHandler";
import { Router } from "./core/router";
import { setupRoutes } from "./routes";

function createRequestHandler() {
  const router = new Router();
  setupRoutes(router);
  return new RequestHandler(router);
}

describe("public HTTP behavior", () => {
  test.each([
    "/blog/does-not-exist",
    "/projects/does-not-exist",
  ])("%s returns a real 404", async (path) => {
    const response = await createRequestHandler().handleRequest(
      new Request(`http://portfolio.test${path}`),
    );

    expect(response.status).toBe(404);
  });

  test("unsupported methods return 405 with allowed methods", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });

  test("OPTIONS advertises supported methods without a body", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(await response.text()).toBe("");
  });

  test("health check reports readiness", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/healthz"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("unused bulk page endpoint is not exposed", async () => {
    const response = await createRequestHandler().handleRequest(
      new Request("http://portfolio.test/api/pages"),
    );

    expect(response.status).toBe(404);
  });
});
