/**
 * The Cloudinary client itself.
 *
 * This file exists because of a bug that reached a live account: the multipart
 * body was assembled without a filename, and Cloudinary answered "Missing
 * required parameter - file". Every existing test used a stubbed
 * `MediaProvider`, so the one class that actually talks to the network was
 * never exercised — the request it builds was nobody's assertion.
 *
 * So these tests intercept `fetch` and assert on the *request*. They are not a
 * substitute for a live call, and they cannot notice Cloudinary changing its
 * mind. What they do is stop a known regression from silently returning.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { CloudinaryProvider, validateProviderResponse } from "./cloudinary";
import type { MediaConfig } from "./config";

const CONFIG: MediaConfig = {
  provider: "cloudinary",
  cloudName: "example-cloud",
  apiKey: "123456789012345",
  apiSecret: "s".repeat(27),
  maxUploadBytes: 10_000_000,
};

const OK_PAYLOAD = {
  asset_id: "asset-abc",
  public_id: "portfolio/an-id",
  version: 1700000000,
  format: "png",
  resource_type: "image",
  bytes: 103,
  width: 2,
  height: 2,
  secure_url: "https://res.cloudinary.com/example-cloud/image/upload/x.png",
};

const realFetch = globalThis.fetch;

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  parts: Map<string, string>;
}

let captured: Captured | null = null;

/**
 * Reads the multipart body as text.
 *
 * Bun computes the boundary lazily, so `Content-Type` has to be read before the
 * body is consumed — the same ordering trap documented in `upload.test.ts`.
 */
function interceptFetch(payload: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as string, init);
    const contentType = request.headers.get("Content-Type") ?? "";
    const body = await request.text();

    const parts = new Map<string, string>();
    for (const chunk of body.split(/--[-\w]+/)) {
      const name = /name="([^"]+)"/.exec(chunk)?.[1];
      if (!name) continue;
      const value = chunk
        .split(/\r?\n\r?\n/)
        .slice(1)
        .join("\n\n")
        .trim();
      parts.set(name, value);
    }

    const headers = new Headers(request.headers);
    headers.set("Content-Type", contentType);

    captured = {
      url: request.url,
      method: request.method,
      headers,
      body,
      parts,
    };

    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  captured = null;
});

const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("the upload request", () => {
  test("carries a filename on the file part", async () => {
    interceptFetch(OK_PAYLOAD);

    await new CloudinaryProvider(CONFIG).upload(
      BYTES,
      "portfolio/an-id",
      "image/png"
    );

    // The regression this file exists for. Without `filename=`, Cloudinary
    // rejects the request outright.
    expect(captured!.body).toContain('name="file"');
    expect(captured!.body).toContain('filename="upload.png"');
  });

  test("the filename describes the bytes, not the uploader", async () => {
    interceptFetch(OK_PAYLOAD);

    await new CloudinaryProvider(CONFIG).upload(
      BYTES,
      "portfolio/an-id",
      "image/webp"
    );

    // Constant, and derived from the content type the magic-byte check already
    // agreed with. A filename from the client would be attacker-chosen.
    expect(captured!.body).toContain('filename="upload.webp"');
  });

  test("sends the public ID, the signed preset, and overwrite=false", async () => {
    interceptFetch(OK_PAYLOAD);

    await new CloudinaryProvider(CONFIG).upload(
      BYTES,
      "portfolio/an-id",
      "image/png"
    );

    expect(captured!.parts.get("public_id")).toBe("portfolio/an-id");
    expect(captured!.parts.get("upload_preset")).toBe("portfolio_owner_images");
    // Replacement is modelled as a new asset; an overwrite would break every
    // published revision pointing at the old bytes.
    expect(captured!.parts.get("overwrite")).toBe("false");
    expect(captured!.parts.get("resource_type")).toBe("image");
  });

  test("posts to the image upload endpoint for the configured cloud", async () => {
    interceptFetch(OK_PAYLOAD);

    await new CloudinaryProvider(CONFIG).upload(BYTES, "x", "image/png");

    expect(captured!.method).toBe("POST");
    expect(captured!.url).toBe(
      "https://api.cloudinary.com/v1_1/example-cloud/image/upload"
    );
  });

  test("authenticates with basic auth and sends the secret nowhere else", async () => {
    interceptFetch(OK_PAYLOAD);

    await new CloudinaryProvider(CONFIG).upload(BYTES, "x", "image/png");

    const authorization = captured!.headers.get("Authorization") ?? "";
    expect(authorization.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(authorization.slice(6), "base64").toString()).toBe(
      `${CONFIG.apiKey}:${CONFIG.apiSecret}`
    );

    // The credential belongs in the header and nowhere else. A secret in the
    // body or the query string ends up in logs and proxies.
    expect(captured!.body).not.toContain(CONFIG.apiSecret);
    expect(captured!.url).not.toContain(CONFIG.apiSecret);
  });

  test("returns validated metadata on success", async () => {
    interceptFetch(OK_PAYLOAD);

    const outcome = await new CloudinaryProvider(CONFIG).upload(
      BYTES,
      "x",
      "image/png"
    );

    expect(outcome).toEqual({
      status: "ok",
      metadata: {
        providerAssetId: "asset-abc",
        providerVersion: "1700000000",
        format: "png",
        bytes: 103,
        width: 2,
        height: 2,
      },
    });
  });

  test("a 4xx is a rejection and a 5xx is an outage", async () => {
    interceptFetch({ error: { message: "nope" } }, 400);
    expect(
      (await new CloudinaryProvider(CONFIG).upload(BYTES, "x", "image/png"))
        .status
    ).toBe("rejected");

    interceptFetch({ error: { message: "boom" } }, 503);
    expect(
      (await new CloudinaryProvider(CONFIG).upload(BYTES, "x", "image/png"))
        .status
    ).toBe("unavailable");
  });
});

describe("the lookup request", () => {
  test("asks about the exact public ID", async () => {
    interceptFetch(OK_PAYLOAD);

    await new CloudinaryProvider(CONFIG).lookup("portfolio/an-id");

    expect(captured!.url).toBe(
      "https://api.cloudinary.com/v1_1/example-cloud/resources/image/upload/portfolio%2Fan-id"
    );
  });

  test("a 404 is 'missing', not an error", async () => {
    interceptFetch({}, 404);

    expect(await new CloudinaryProvider(CONFIG).lookup("x")).toEqual({
      status: "missing",
    });
  });
});

describe("destroy", () => {
  /** Answers the lookup, then the destroy, recording both requests. */
  function interceptDestroy(
    lookupPayload: unknown,
    lookupStatus = 200
  ): string[] {
    const urls: string[] = [];
    let call = 0;

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const request = new Request(input as string, init);
      urls.push(`${request.method} ${request.url}`);
      call += 1;

      if (call === 1) {
        return new Response(JSON.stringify(lookupPayload), {
          status: lookupStatus,
          headers: { "Content-Type": "application/json" },
        });
      }

      captured = {
        url: request.url,
        method: request.method,
        headers: new Headers(request.headers),
        body: await request.text(),
        parts: new Map(),
      };

      return new Response(JSON.stringify({ result: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    return urls;
  }

  test("addresses the delete by public ID, which is what Cloudinary accepts", async () => {
    interceptDestroy(OK_PAYLOAD);

    const ok = await new CloudinaryProvider(CONFIG).destroy(
      "portfolio/an-id",
      "asset-abc"
    );

    expect(ok).toBe(true);
    // The original code sent `asset_id` here and Cloudinary answered
    // "Missing required parameter - public_id".
    expect(JSON.parse(captured!.body)).toEqual({
      public_id: "portfolio/an-id",
    });
  });

  test("refuses when a different asset occupies the public ID", async () => {
    const urls = interceptDestroy({ ...OK_PAYLOAD, asset_id: "someone-else" });

    const ok = await new CloudinaryProvider(CONFIG).destroy(
      "portfolio/an-id",
      "asset-abc"
    );

    // The immutable id is the authority even though it cannot be the address.
    expect(ok).toBe(false);
    expect(urls).toHaveLength(1);
    expect(urls[0]!.startsWith("GET")).toBe(true);
  });

  test("an already-absent asset is success, so retries are idempotent", async () => {
    const urls = interceptDestroy({}, 404);

    expect(
      await new CloudinaryProvider(CONFIG).destroy(
        "portfolio/gone",
        "asset-abc"
      )
    ).toBe(true);
    // Nothing to delete: it never issued the destroy.
    expect(urls).toHaveLength(1);
  });

  test("a provider outage is not reported as a deletion", async () => {
    interceptDestroy({ error: "boom" }, 500);

    expect(
      await new CloudinaryProvider(CONFIG).destroy("portfolio/x", "asset-abc")
    ).toBe(false);
  });
});

describe("response validation is still the gate", () => {
  test("a provider response that disagrees with itself is refused", () => {
    // Belt and braces: even with a live-shaped request, the response is
    // untrusted input.
    expect(
      validateProviderResponse({ ...OK_PAYLOAD, format: "svg" }, 10_000_000)
        .status
    ).toBe("rejected");
    expect(
      validateProviderResponse(
        { ...OK_PAYLOAD, resource_type: "raw" },
        10_000_000
      ).status
    ).toBe("rejected");
  });
});
