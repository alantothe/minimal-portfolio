/**
 * The property under test is that identity comes from the bytes.
 *
 * Nearly every case here is a restatement of that: the same bytes twice produce
 * one asset, a fresh database produces the same ids, an asset already at the
 * provider is adopted rather than duplicated, and a public ID whose row holds a
 * different digest is refused outright.
 *
 * The provider stub counts its calls, because "did not upload again" is the
 * assertion that matters for a re-run and it is invisible in the return value.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database/connection";
import { runMigrations } from "../database/migrator";
import { MediaRepository } from "../database/mediaRepository";
import {
  adoptImageBytes,
  contentAddressedId,
  contentAddressedPublicId,
  contentDigest,
} from "./adopt";
import type { LookupOutcome, MediaProvider, UploadOutcome } from "./cloudinary";
import type { MediaConfig } from "./config";
import type { ProviderMetadata } from "../database/mediaRepository";

const CONFIG: MediaConfig = {
  provider: "cloudinary",
  cloudName: "test-cloud",
  apiKey: "key",
  apiSecret: "secret",
  maxUploadBytes: 10_000,
};

const METADATA: ProviderMetadata = {
  providerAssetId: "provider-asset-1",
  providerVersion: "1700000000",
  format: "png",
  bytes: 68,
  width: 64,
  height: 64,
};

/** A minimal but genuinely valid PNG header, so magic-byte detection passes. */
function pngBytes(marker = 0): Uint8Array {
  const bytes = new Uint8Array(68);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[67] = marker;
  return bytes;
}

class StubProvider implements MediaProvider {
  uploadCalls = 0;
  lookupCalls = 0;
  destroyCalls = 0;
  readonly uploadedPublicIds: string[] = [];

  constructor(
    private readonly uploadOutcome: UploadOutcome = {
      status: "ok",
      metadata: METADATA,
    },
    private readonly lookupOutcome: LookupOutcome = { status: "missing" }
  ) {}

  async upload(_bytes: Uint8Array, publicId: string): Promise<UploadOutcome> {
    this.uploadCalls += 1;
    this.uploadedPublicIds.push(publicId);

    if (this.uploadOutcome.status !== "ok") {
      return this.uploadOutcome;
    }

    // A distinct asset id per upload, because that is what Cloudinary does and
    // because `provider_asset_id` is UNIQUE. A stub that reused one would make
    // the second upload of the run fail for a reason no real provider produces.
    return {
      status: "ok",
      metadata: {
        ...this.uploadOutcome.metadata,
        providerAssetId: `${this.uploadOutcome.metadata.providerAssetId}-${this.uploadCalls}`,
      },
    };
  }

  async lookup(): Promise<LookupOutcome> {
    this.lookupCalls += 1;
    return this.lookupOutcome;
  }

  async destroy(): Promise<boolean> {
    this.destroyCalls += 1;
    return true;
  }
}

const directories: string[] = [];

function freshDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "adopt-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

function freshRepository(): MediaRepository {
  return new MediaRepository(freshDatabase());
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("identity", () => {
  test("the id and public ID are a pure function of the content", () => {
    const digest = contentDigest(pngBytes());

    expect(contentDigest(pngBytes())).toBe(digest);
    expect(contentDigest(pngBytes(1))).not.toBe(digest);
    expect(contentAddressedPublicId(contentAddressedId(digest))).toBe(
      `portfolio/${contentAddressedId(digest)}`
    );
  });

  test("two fresh databases give the same bytes the same id", async () => {
    const first = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository: freshRepository(),
      provider: new StubProvider(),
    });

    const second = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository: freshRepository(),
      provider: new StubProvider(),
    });

    expect(first.status).toBe("adopted");
    expect(second.status).toBe("adopted");
    // This is #42's acceptance in miniature: identical input, identical report.
    expect(first.status === "adopted" && first.asset.id).toBe(
      second.status === "adopted" ? second.asset.id : "different"
    );
  });
});

describe("deduplication", () => {
  test("the same bytes under two references upload once", async () => {
    const repository = freshRepository();
    const provider = new StubProvider();
    const dependencies = { config: CONFIG, repository, provider };

    const first = await adoptImageBytes(pngBytes(), dependencies, {
      originalFilename: "og.png",
    });
    const second = await adoptImageBytes(pngBytes(), dependencies, {
      originalFilename: "card.png",
    });

    expect(first.status).toBe("adopted");
    expect(second.status).toBe("already_adopted");
    expect(provider.uploadCalls).toBe(1);
    expect(first.status === "adopted" && first.asset.id).toBe(
      second.status === "already_adopted" ? second.asset.id : "different"
    );
  });

  test("different bytes get different assets", async () => {
    const repository = freshRepository();
    const provider = new StubProvider();
    const dependencies = { config: CONFIG, repository, provider };

    const first = await adoptImageBytes(pngBytes(0), dependencies);
    const second = await adoptImageBytes(pngBytes(1), dependencies);

    expect(first.status).toBe("adopted");
    expect(second.status).toBe("adopted");
    expect(provider.uploadCalls).toBe(2);
    expect(new Set(provider.uploadedPublicIds).size).toBe(2);
  });
});

describe("re-running against a provider that already holds the asset", () => {
  test("a rejected upload is reconciled through lookup rather than duplicated", async () => {
    // What a second rehearsal against a fresh database actually hits: the row
    // is gone but Cloudinary still has the asset, and `overwrite=false` means
    // the upload is refused.
    const provider = new StubProvider(
      { status: "rejected", reason: "provider_rejected_upload" },
      { status: "found", metadata: METADATA }
    );

    const outcome = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository: freshRepository(),
      provider,
    });

    expect(outcome.status).toBe("adopted");
    expect(provider.lookupCalls).toBe(1);
    expect(outcome.status === "adopted" && outcome.asset.status).toBe("ready");
  });

  test("an ambiguous failure that did store the asset is reconciled", async () => {
    const provider = new StubProvider(
      { status: "unavailable", reason: "provider_unreachable" },
      { status: "found", metadata: METADATA }
    );

    const outcome = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository: freshRepository(),
      provider,
    });

    expect(outcome.status).toBe("adopted");
  });

  test("nothing is destroyed on any path", async () => {
    const provider = new StubProvider(
      { status: "rejected", reason: "provider_rejected_upload" },
      { status: "found", metadata: METADATA }
    );

    await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository: freshRepository(),
      provider,
    });

    expect(provider.destroyCalls).toBe(0);
  });
});

describe("failure", () => {
  test("a genuine rejection marks the row failed and reports the reason", async () => {
    const repository = freshRepository();
    const provider = new StubProvider(
      { status: "rejected", reason: "provider_format_not_allowed" },
      { status: "missing" }
    );

    const outcome = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository,
      provider,
    });

    expect(outcome).toEqual({
      status: "rejected",
      reason: "provider_format_not_allowed",
    });

    const row = repository.findByPublicId(
      contentAddressedPublicId(contentAddressedId(contentDigest(pngBytes())))
    );
    expect(row?.status).toBe("failed");
  });

  test("a failed row is retried, because the digest proves it is the same image", async () => {
    const repository = freshRepository();

    const failed = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository,
      provider: new StubProvider(
        { status: "rejected", reason: "provider_rejected_upload" },
        { status: "missing" }
      ),
    });
    expect(failed.status).toBe("rejected");

    const retried = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository,
      provider: new StubProvider(),
    });

    expect(retried.status).toBe("adopted");
    expect(retried.status === "adopted" && retried.asset.status).toBe("ready");
  });

  test("an interrupted upload resumes rather than claiming a second row", async () => {
    const repository = freshRepository();
    const digest = contentDigest(pngBytes());
    const id = contentAddressedId(digest);

    // Exactly the state a crash between `beginUpload` and the provider's reply
    // leaves behind.
    repository.beginUpload({
      id,
      providerPublicId: contentAddressedPublicId(id),
      originalFilename: null,
      digest,
    });

    const provider = new StubProvider();
    const outcome = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository,
      provider,
    });

    expect(outcome.status).toBe("adopted");
    expect(outcome.status === "adopted" && outcome.asset.id).toBe(id);
    expect(provider.uploadCalls).toBe(1);
  });

  test("a public ID holding a different digest is refused, never overwritten", async () => {
    const repository = freshRepository();
    const digest = contentDigest(pngBytes());
    const id = contentAddressedId(digest);

    // Impossible under content addressing, which is the point: if the invariant
    // ever breaks, the code must refuse rather than rebind the public ID.
    const planted = repository.beginUpload({
      id,
      providerPublicId: contentAddressedPublicId(id),
      originalFilename: null,
      digest: "a-completely-different-digest",
    });
    repository.markFailed(planted.id);

    const outcome = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository,
      provider: new StubProvider(),
    });

    expect(outcome).toEqual({
      status: "rejected",
      reason: "media_asset_identity_conflict",
    });
  });

  test("a tombstoned asset is not resurrected by an import", async () => {
    const database = freshDatabase();
    const repository = new MediaRepository(database);
    const digest = contentDigest(pngBytes());
    const id = contentAddressedId(digest);

    repository.beginUpload({
      id,
      providerPublicId: contentAddressedPublicId(id),
      originalFilename: null,
      digest,
    });
    // No repository method tombstones an asset yet — that arrives with the
    // deletion slice. Reaching for SQL here beats inventing the method early.
    database
      .query("UPDATE media_assets SET status = 'tombstoned' WHERE id = ?")
      .run(id);

    const provider = new StubProvider();
    const outcome = await adoptImageBytes(pngBytes(), {
      config: CONFIG,
      repository,
      provider,
    });

    expect(outcome).toEqual({
      status: "rejected",
      reason: "media_asset_tombstoned",
    });
    expect(provider.uploadCalls).toBe(0);
  });
});

describe("the bytes are checked before the provider is paid", () => {
  test("a non-image is refused without a network call", async () => {
    const provider = new StubProvider();
    const outcome = await adoptImageBytes(
      new TextEncoder().encode(
        "<svg xmlns='http://www.w3.org/2000/svg'></svg>"
      ),
      { config: CONFIG, repository: freshRepository(), provider }
    );

    expect(outcome).toEqual({
      status: "rejected",
      reason: "svg_not_supported",
    });
    expect(provider.uploadCalls).toBe(0);
  });

  test("an oversized file is refused without a network call", async () => {
    const provider = new StubProvider();
    const big = new Uint8Array(CONFIG.maxUploadBytes + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const outcome = await adoptImageBytes(big, {
      config: CONFIG,
      repository: freshRepository(),
      provider,
    });

    expect(outcome).toEqual({ status: "rejected", reason: "file_too_large" });
    expect(provider.uploadCalls).toBe(0);
  });

  test("empty input is refused", async () => {
    const outcome = await adoptImageBytes(new Uint8Array(0), {
      config: CONFIG,
      repository: freshRepository(),
      provider: new StubProvider(),
    });

    expect(outcome).toEqual({ status: "rejected", reason: "empty_file" });
  });
});
