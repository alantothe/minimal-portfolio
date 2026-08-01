/**
 * The upload path, including every way it can go wrong.
 *
 * The provider is a stub that records what it was asked to do, because several
 * of the required guarantees are about the *calls* rather than the response:
 * that nothing is sent until the local checks pass, that the public ID is never
 * derived from the filename, and that a lost response is reconciled by asking
 * rather than by retrying.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database/connection";
import { runMigrations } from "../database/migrator";
import { MediaRepository } from "../database/mediaRepository";
import { handleMediaUpload, type UploadDependencies } from "./upload";
import type { LookupOutcome, MediaProvider, UploadOutcome } from "./cloudinary";
import type { MediaConfig } from "./config";

const CONFIG: MediaConfig = {
  provider: "cloudinary",
  cloudName: "example-cloud",
  apiKey: "123456789012345",
  apiSecret: "s".repeat(27),
  maxUploadBytes: 10_000,
};

const VALID_METADATA = {
  providerAssetId: "asset-abc",
  providerVersion: "1700000000",
  format: "png" as const,
  bytes: 64,
  width: 800,
  height: 600,
};

interface StubOptions {
  upload?: UploadOutcome;
  lookup?: LookupOutcome;
  destroySucceeds?: boolean;
}

class StubProvider implements MediaProvider {
  readonly uploads: Array<{
    publicId: string;
    contentType: string;
    bytes: number;
  }> = [];
  readonly lookups: string[] = [];
  readonly destroyed: string[] = [];

  constructor(private readonly options: StubOptions = {}) {}

  async upload(
    bytes: Uint8Array,
    publicId: string,
    contentType: string
  ): Promise<UploadOutcome> {
    this.uploads.push({ publicId, contentType, bytes: bytes.byteLength });
    return this.options.upload ?? { status: "ok", metadata: VALID_METADATA };
  }

  async lookup(publicId: string): Promise<LookupOutcome> {
    this.lookups.push(publicId);
    return this.options.lookup ?? { status: "missing" };
  }

  async destroy(providerAssetId: string): Promise<boolean> {
    this.destroyed.push(providerAssetId);
    return this.options.destroySucceeds ?? true;
  }
}

const temporaryDirectories: string[] = [];

function migratedDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "media-upload-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function dependencies(options: StubOptions = {}): UploadDependencies & {
  provider: StubProvider;
  repository: MediaRepository;
} {
  return {
    config: CONFIG,
    repository: new MediaRepository(migratedDatabase()),
    provider: new StubProvider(options),
  };
}

/**
 * `Blob` will not accept a `Uint8Array` that might be backed by a
 * `SharedArrayBuffer`, so the bytes are copied into a plain one first.
 */
function blob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}

function pngBytes(length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
  );
}

/**
 * Builds the request the workspace would send.
 *
 * The body is encoded through `Response` rather than `Request` because Bun
 * exposes the generated multipart boundary on the former only. Encoding it once
 * up front also means `Content-Length` is the real byte count, so the size
 * checks are tested against a truthful header rather than an invented one.
 */
async function uploadRequest(
  parts: Array<[string, Blob | string, string?]>
): Promise<Request> {
  const form = new FormData();
  for (const [name, value, filename] of parts) {
    if (typeof value === "string") {
      form.append(name, value);
    } else {
      form.append(name, value, filename ?? "image.png");
    }
  }

  const encoded = new Response(form);

  // Read the header before the body. Bun computes the multipart boundary
  // lazily, and consuming the body first leaves `Content-Type` null — which
  // would make every test here fail as "not multipart" for the wrong reason.
  const contentType = encoded.headers.get("Content-Type")!;
  const body = await encoded.arrayBuffer();

  return new Request("https://example.test/admin/api/media", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
    body,
  });
}

function pngUpload(bytes = pngBytes(), type = "image/png") {
  return uploadRequest([["file", blob(bytes, type)]]);
}

describe("a successful upload", () => {
  test("stores the asset and reports it ready", async () => {
    const deps = dependencies();

    const response = await handleMediaUpload(await pngUpload(), deps);

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.width).toBe(800);
    expect(body.height).toBe(600);
    expect(body.format).toBe("png");

    const stored = deps.repository.findById(body.id as string);
    expect(stored?.status).toBe("ready");
    expect(stored?.providerAssetId).toBe("asset-abc");
  });

  test("never derives the provider ID from the filename", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(pngBytes(), "image/png"), "../../etc/passwd"],
    ]);
    const response = await handleMediaUpload(request, deps);
    const body = (await response.json()) as { id: string };

    expect(deps.provider.uploads[0]!.publicId).toBe(`portfolio/${body.id}`);
    expect(deps.provider.uploads[0]!.publicId).not.toContain("passwd");
  });

  test("keeps the original filename only as sanitised display text", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(pngBytes(), "image/png"), "../../etc/pass wd.png"],
    ]);
    const response = await handleMediaUpload(request, deps);
    const body = (await response.json()) as {
      id: string;
      originalFilename: string;
    };

    expect(body.originalFilename).toBe("pass_wd.png");
    expect(body.originalFilename).not.toContain("/");
  });

  test("returns no delivery URL or provider credentials", async () => {
    const deps = dependencies();

    const response = await handleMediaUpload(await pngUpload(), deps);
    const raw = await response.text();

    expect(raw).not.toContain("cloudinary");
    expect(raw).not.toContain(CONFIG.apiSecret);
    expect(raw).not.toContain("https://");
  });

  test("records a digest of the bytes", async () => {
    const deps = dependencies();

    const response = await handleMediaUpload(await pngUpload(), deps);
    const body = (await response.json()) as { id: string };

    expect(deps.repository.findById(body.id)?.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("files that are refused before reaching the provider", () => {
  test("rejects SVG, which is script rather than an image", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(svgBytes(), "image/svg+xml"), "logo.svg"],
    ]);
    const response = await handleMediaUpload(request, deps);

    expect(response.status).toBe(415);
    expect((await response.json()).error).toBe("svg_not_supported");
    expect(deps.provider.uploads).toHaveLength(0);
  });

  test("rejects an SVG disguised with a PNG content type and name", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(svgBytes(), "image/png"), "innocent.png"],
    ]);
    const response = await handleMediaUpload(request, deps);

    expect(response.status).toBe(415);
    expect(deps.provider.uploads).toHaveLength(0);
  });

  test("rejects an animated GIF", async () => {
    const deps = dependencies();
    const gif = new Uint8Array(64);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);

    const request = await uploadRequest([
      ["file", blob(gif, "image/gif"), "loop.gif"],
    ]);
    const response = await handleMediaUpload(request, deps);

    expect(response.status).toBe(415);
    expect((await response.json()).error).toBe("gif_not_supported");
  });

  test("rejects an empty file", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(new Uint8Array(0), "image/png")],
    ]);
    const response = await handleMediaUpload(request, deps);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("empty_file");
  });

  test("rejects a file over the byte limit", async () => {
    const deps = dependencies();

    const response = await handleMediaUpload(
      await pngUpload(pngBytes(CONFIG.maxUploadBytes + 1)),
      deps
    );

    expect(response.status).toBe(413);
    expect(deps.provider.uploads).toHaveLength(0);
  });

  test("rejects more than one file", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(pngBytes(), "image/png")],
      ["file", blob(pngBytes(), "image/png")],
    ]);
    const response = await handleMediaUpload(request, deps);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("unexpected_form_fields");
  });

  test("rejects unexpected form fields", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(pngBytes(), "image/png")],
      ["public_id", "portfolio/attacker-chosen"],
    ]);
    const response = await handleMediaUpload(request, deps);

    expect(response.status).toBe(400);
    expect(deps.provider.uploads).toHaveLength(0);
  });

  test("rejects a body that is not multipart", async () => {
    const deps = dependencies();

    const response = await handleMediaUpload(
      new Request("https://example.test/admin/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "2" },
        body: "{}",
      }),
      deps
    );

    expect(response.status).toBe(415);
  });

  test("rejects a request with no Content-Length", async () => {
    const deps = dependencies();
    const form = new FormData();
    form.append("file", blob(pngBytes(), "image/png"));

    const response = await handleMediaUpload(
      new Request("https://example.test/admin/api/media", {
        method: "POST",
        body: form,
      }),
      deps
    );

    expect(response.status).toBe(411);
  });

  test("writes no database row for a refused file", async () => {
    const deps = dependencies();

    const request = await uploadRequest([
      ["file", blob(svgBytes(), "image/svg+xml")],
    ]);
    await handleMediaUpload(request, deps);

    expect(deps.repository.listReady()).toHaveLength(0);
  });
});

describe("provider responses that cannot be trusted", () => {
  test("a rejected upload marks the asset failed", async () => {
    const deps = dependencies({
      upload: { status: "rejected", reason: "provider_format_not_allowed" },
    });

    const response = await handleMediaUpload(await pngUpload(), deps);

    expect(response.status).toBe(502);
    expect(deps.repository.listReady()).toHaveLength(0);
  });

  test("an unavailable provider with nothing stored fails cleanly", async () => {
    const deps = dependencies({
      upload: { status: "unavailable", reason: "provider_unreachable" },
      lookup: { status: "missing" },
    });

    const response = await handleMediaUpload(await pngUpload(), deps);

    expect(response.status).toBe(503);
    expect(deps.repository.listReady()).toHaveLength(0);
  });

  test("a lost response is reconciled by asking, not by re-uploading", async () => {
    const deps = dependencies({
      upload: { status: "unavailable", reason: "provider_unreachable" },
      lookup: { status: "found", metadata: VALID_METADATA },
    });

    const response = await handleMediaUpload(await pngUpload(), deps);

    expect(response.status).toBe(201);
    expect(deps.provider.uploads).toHaveLength(1);
    expect(deps.provider.lookups).toEqual([deps.provider.uploads[0]!.publicId]);
    expect(deps.repository.listReady()).toHaveLength(1);
  });
});

describe("the local record", () => {
  test("is written before the provider is contacted", async () => {
    const deps = dependencies({
      upload: { status: "unavailable", reason: "provider_unreachable" },
    });

    const response = await handleMediaUpload(await pngUpload(), deps);
    expect(response.status).toBe(503);

    // A failed row survives, carrying the public ID that may exist upstream.
    const publicId = deps.provider.uploads[0]!.publicId;
    expect(deps.repository.findByPublicId(publicId)?.status).toBe("failed");
  });

  test("cannot be finalised twice", async () => {
    const deps = dependencies();

    const response = await handleMediaUpload(await pngUpload(), deps);
    const body = (await response.json()) as { id: string };

    expect(deps.repository.finalizeUpload(body.id, VALID_METADATA)).toBeNull();
  });

  test("refuses a ready asset that is missing provider metadata", () => {
    const deps = dependencies();
    deps.repository.beginUpload({
      id: "abc",
      providerPublicId: "portfolio/abc",
    });

    expect(() =>
      deps.repository.finalizeUpload("abc", {
        ...VALID_METADATA,
        providerVersion: null as unknown as string,
      })
    ).toThrow();
  });

  test("never reuses a provider public ID", async () => {
    const deps = dependencies();
    deps.repository.beginUpload({
      id: "first",
      providerPublicId: "portfolio/taken",
    });

    expect(() =>
      deps.repository.beginUpload({
        id: "second",
        providerPublicId: "portfolio/taken",
      })
    ).toThrow();
  });
});
