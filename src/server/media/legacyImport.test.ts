/**
 * Adopting a legacy asset, with "the provider is the source of truth" as the
 * property under test.
 *
 * The stub deliberately answers with metadata that *disagrees* with the URL —
 * a different format, different dimensions — so that a test can prove the
 * stored record follows the provider rather than the string. If the import ever
 * regressed to trusting the URL, that one assertion fails.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database/connection";
import { runMigrations } from "../database/migrator";
import { MediaRepository } from "../database/mediaRepository";
import { importLegacyCloudinaryImage } from "./legacyImport";
import type { LookupOutcome, MediaProvider, UploadOutcome } from "./cloudinary";

const CLOUD = "dz18m79a1";
const QUESTURIAN =
  "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png";

/** Intentionally unlike what the URL implies. */
const PROVIDER_TRUTH = {
  providerAssetId: "asset-from-provider",
  providerVersion: "1900000000",
  format: "webp" as const,
  bytes: 12_345,
  width: 1024,
  height: 768,
};

class StubProvider implements MediaProvider {
  readonly lookups: string[] = [];
  readonly uploads: string[] = [];

  constructor(private readonly outcome: LookupOutcome) {}

  async upload(): Promise<UploadOutcome> {
    this.uploads.push("upload");
    return { status: "rejected", reason: "not_expected" };
  }

  async lookup(publicId: string): Promise<LookupOutcome> {
    this.lookups.push(publicId);
    return this.outcome;
  }

  async destroy(): Promise<boolean> {
    return true;
  }
}

const found = new StubProvider({ status: "found", metadata: PROVIDER_TRUTH });

const temporaryDirectories: string[] = [];

function migratedDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "legacy-import-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

function repository(): MediaRepository {
  return new MediaRepository(migratedDatabase());
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("importing a legacy Cloudinary asset", () => {
  test("asks the provider about the public ID from the URL", async () => {
    const provider = new StubProvider({
      status: "found",
      metadata: PROVIDER_TRUTH,
    });

    const outcome = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: repository(),
      provider,
      cloudName: CLOUD,
    });

    expect(outcome.status).toBe("imported");
    expect(provider.lookups).toEqual(["questura_rbayjx"]);
  });

  test("stores what the provider said, not what the URL said", async () => {
    const outcome = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: repository(),
      provider: found,
      cloudName: CLOUD,
    });

    expect(outcome).toMatchObject({
      status: "imported",
      asset: {
        status: "ready",
        providerAssetId: "asset-from-provider",
        // The URL says png at v1761780791 with a 300x180 crop. None of that is
        // evidence, so none of it is stored.
        format: "webp",
        providerVersion: "1900000000",
        width: 1024,
        height: 768,
        bytes: 12_345,
      },
    });
  });

  test("records no digest, because no bytes were ever seen", async () => {
    const outcome = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: repository(),
      provider: found,
      cloudName: CLOUD,
    });

    // A digest implies the application verified the content. It did not.
    expect(outcome).toMatchObject({ asset: { digest: null } });
  });

  test("never uploads anything", async () => {
    const provider = new StubProvider({
      status: "found",
      metadata: PROVIDER_TRUTH,
    });

    await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: repository(),
      provider,
      cloudName: CLOUD,
    });

    expect(provider.uploads).toEqual([]);
  });

  test("refuses a URL naming a cloud the provider is not authenticated for", async () => {
    const provider = new StubProvider({
      status: "found",
      metadata: PROVIDER_TRUTH,
    });

    const outcome = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: repository(),
      provider,
      cloudName: "some-other-cloud",
    });

    expect(outcome).toEqual({
      status: "rejected",
      reason: "legacy_cloud_mismatch",
    });
    // The decisive part: it did not ask about a public ID in the wrong account.
    expect(provider.lookups).toEqual([]);
  });

  test("refuses a URL that is not a Cloudinary delivery URL", async () => {
    const provider = new StubProvider({ status: "missing" });

    for (const candidate of [
      "https://evil.test/cloud/image/upload/v1/x.png",
      "/public/og.png",
      "not a url",
    ]) {
      const outcome = await importLegacyCloudinaryImage(candidate, {
        repository: repository(),
        provider,
        cloudName: CLOUD,
      });

      expect(outcome).toEqual({
        status: "rejected",
        reason: "not_a_cloudinary_delivery_url",
      });
    }

    expect(provider.lookups).toEqual([]);
  });

  test("refuses an asset the provider does not have", async () => {
    const outcome = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: repository(),
      provider: new StubProvider({ status: "missing" }),
      cloudName: CLOUD,
    });

    expect(outcome).toEqual({
      status: "rejected",
      reason: "legacy_asset_not_found",
    });
  });

  test("a provider outage records nothing and stays re-runnable", async () => {
    const media = repository();

    const outcome = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: media,
      provider: new StubProvider({
        status: "unavailable",
        reason: "provider_unreachable",
      }),
      cloudName: CLOUD,
    });

    expect(outcome).toEqual({
      status: "unavailable",
      reason: "provider_unreachable",
    });
    // No half-claimed row: re-running after the outage must be a clean import,
    // not a collision on the unique public ID.
    expect(media.findByPublicId("questura_rbayjx")).toBeNull();
  });

  test("is idempotent: a second run imports nothing and asks nothing", async () => {
    const media = repository();
    const provider = new StubProvider({
      status: "found",
      metadata: PROVIDER_TRUTH,
    });

    const first = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: media,
      provider,
      cloudName: CLOUD,
    });
    const second = await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: media,
      provider,
      cloudName: CLOUD,
    });

    expect(first.status).toBe("imported");
    expect(second.status).toBe("already_imported");
    expect(provider.lookups).toHaveLength(1);

    // Same record, not a duplicate under a second local id.
    expect((second as { asset: { id: string } }).asset.id).toBe(
      (first as { asset: { id: string } }).asset.id
    );
  });

  test("a differently-transformed URL for the same asset is not re-imported", async () => {
    const media = repository();
    const provider = new StubProvider({
      status: "found",
      metadata: PROVIDER_TRUTH,
    });

    await importLegacyCloudinaryImage(QUESTURIAN, {
      repository: media,
      provider,
      cloudName: CLOUD,
    });

    // Same public ID, different crop and no version — identity is the public
    // ID, not the string.
    const outcome = await importLegacyCloudinaryImage(
      "https://res.cloudinary.com/dz18m79a1/image/upload/w_50/questura_rbayjx.png",
      { repository: media, provider, cloudName: CLOUD }
    );

    expect(outcome.status).toBe("already_imported");
  });
});
