/**
 * The guards, against a real server.
 *
 * The origin check is pure and could be asserted without one, but the byte cap
 * and the redirect refusal cannot: both are properties of how `fetch` actually
 * behaves. Since the whole reason this module exists is that a URL taken out of
 * content is being requested, stubbing `fetch` here would amount to testing the
 * stub.
 *
 * The server binds to loopback on an ephemeral port, and `allowedOrigin` is
 * pointed at it. That override exists for these tests and for nothing else.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DELIVERY_ORIGIN, fetchDeliveredImage } from "./fetchImage";

describe("origin pinning", () => {
  const cases: Array<[string, string]> = [
    ["plain HTTP", "http://res.cloudinary.com/a/image/upload/x.png"],
    ["another host entirely", "https://evil.example/x.png"],
    // Contains the allowed host as a prefix of a longer name. An `endsWith` or
    // `includes` check would have let both of these through.
    ["a lookalike suffix", "https://res.cloudinary.com.evil.example/x.png"],
    [
      "credentials naming the real host",
      "https://res.cloudinary.com@evil.example/x.png",
    ],
    ["a non-default port", "https://res.cloudinary.com:8443/x.png"],
  ];

  for (const [name, url] of cases) {
    test(`refuses ${name}`, async () => {
      expect(await fetchDeliveredImage(url, { maxBytes: 1000 })).toEqual({
        status: "rejected",
        reason: "origin_not_allowed",
      });
    });
  }

  test("refuses a malformed URL", async () => {
    expect(await fetchDeliveredImage("not a url", { maxBytes: 1000 })).toEqual({
      status: "rejected",
      reason: "invalid_url",
    });
  });

  test("production is pinned to the Cloudinary delivery host", () => {
    expect(DELIVERY_ORIGIN).toBe("https://res.cloudinary.com");
  });
});

describe("against a live server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const { pathname } = new URL(request.url);

        if (pathname === "/small.png") {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            headers: { "Content-Type": "image/png" },
          });
        }

        if (pathname === "/declared-huge.png") {
          // An honest Content-Length, over the cap.
          return new Response(new Uint8Array(5000), {
            headers: { "Content-Type": "image/png" },
          });
        }

        if (pathname === "/undeclared-huge.png") {
          // Streamed, so no length is declared. The cap has to be enforced
          // while reading or it is not enforced at all.
          return new Response(
            new ReadableStream({
              start(controller) {
                for (let index = 0; index < 20; index += 1) {
                  controller.enqueue(new Uint8Array(1000));
                }
                controller.close();
              },
            }),
            { headers: { "Content-Type": "image/png" } }
          );
        }

        if (pathname === "/redirect.png") {
          return Response.redirect("https://evil.example/x.png", 302);
        }

        if (pathname === "/empty.png") {
          return new Response(new Uint8Array(0));
        }

        if (pathname === "/boom.png") {
          return new Response("no", { status: 500 });
        }

        return new Response("gone", { status: 404 });
      },
    });

    origin = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  function get(path: string, maxBytes = 4096) {
    return fetchDeliveredImage(`${origin}${path}`, {
      maxBytes,
      allowedOrigin: origin,
    });
  }

  test("a small image comes back whole", async () => {
    const outcome = await get("/small.png");

    expect(outcome.status).toBe("ok");
    expect(outcome.status === "ok" && outcome.bytes.byteLength).toBe(4);
    expect(outcome.status === "ok" && outcome.contentType).toBe("image/png");
  });

  test("a declared length over the cap is refused", async () => {
    expect(await get("/declared-huge.png")).toEqual({
      status: "rejected",
      reason: "file_too_large",
    });
  });

  test("a body over the cap that declares no length is refused mid-stream", async () => {
    expect(await get("/undeclared-huge.png")).toEqual({
      status: "rejected",
      reason: "file_too_large",
    });
  });

  test("a redirect is refused rather than followed off the pinned origin", async () => {
    // `redirect: "error"` makes `fetch` throw, which this module reports as an
    // outage. The status matters less than the guarantee: the bytes never come
    // from evil.example.
    expect((await get("/redirect.png")).status).toBe("unavailable");
  });

  test("a 404 is a rejection, not an outage", async () => {
    expect(await get("/missing.png")).toEqual({
      status: "rejected",
      reason: "legacy_asset_not_found",
    });
  });

  test("a 500 is an outage, so the import stays re-runnable", async () => {
    expect(await get("/boom.png")).toEqual({
      status: "unavailable",
      reason: "legacy_asset_unreachable",
    });
  });

  test("an empty body is refused", async () => {
    expect(await get("/empty.png")).toEqual({
      status: "rejected",
      reason: "empty_file",
    });
  });
});
