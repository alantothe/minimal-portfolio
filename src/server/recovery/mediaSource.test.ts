import { afterEach, expect, test } from "bun:test";
import type { MediaAsset } from "../database/mediaRepository";
import { CloudinaryOriginalSource } from "./mediaSource";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("downloads exact versioned Cloudinary original without transformation", async () => {
  let requested = "";
  const bytes = new Uint8Array(64);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
      },
    });
  }) as typeof fetch;
  const asset = {
    id: "asset",
    provider: "cloudinary",
    providerAssetId: "provider-asset",
    providerPublicId: "portfolio/asset",
    providerVersion: "1700000000",
    format: "png",
    bytes: 64,
    width: 20,
    height: 20,
    status: "ready",
    originalFilename: "asset.png",
    altText: null,
    digest: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  } satisfies MediaAsset;

  const original = await new CloudinaryOriginalSource(
    "example-cloud",
    10_000
  ).download(asset);

  expect(requested).toBe(
    "https://res.cloudinary.com/example-cloud/image/upload/v1700000000/portfolio/asset.png"
  );
  expect(original).toEqual({ bytes, format: "png" });
});
