/**
 * Policy tests: which references this resolver will adopt, and by what route.
 *
 * The filesystem and the network are both injected, so what is under test is
 * the decision — configured cloud goes to the Admin API, the legacy cloud gets
 * fetched and re-uploaded, everything else is refused — rather than Bun's
 * `fetch`. The one thing deliberately *not* stubbed is the adoption path, so
 * these also prove the resolver and the content-addressing agree.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../database/connection";
import { runMigrations } from "../../database/migrator";
import { MediaRepository } from "../../database/mediaRepository";
import { importMediaResolver, type ResolverDiagnostic } from "./mediaResolver";
import type { FetchImageOutcome } from "../../media/fetchImage";
import type {
  LookupOutcome,
  MediaProvider,
  UploadOutcome,
} from "../../media/cloudinary";
import type { MediaConfig } from "../../media/config";
import type { ProviderMetadata } from "../../database/mediaRepository";

const CONFIG: MediaConfig = {
  provider: "cloudinary",
  cloudName: "configured-cloud",
  apiKey: "key",
  apiSecret: "secret",
  maxUploadBytes: 10_000,
};

const LEGACY_CLOUD = "dz18m79a1";

const QUESTURIAN =
  "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png";

const METADATA: ProviderMetadata = {
  providerAssetId: "provider-asset",
  providerVersion: "1700000000",
  format: "png",
  bytes: 68,
  width: 64,
  height: 64,
};

function pngBytes(marker = 0): Uint8Array {
  const bytes = new Uint8Array(68);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[67] = marker;
  return bytes;
}

class StubProvider implements MediaProvider {
  uploadCalls = 0;
  lookupCalls = 0;

  constructor(
    private readonly lookupOutcome: LookupOutcome = { status: "missing" }
  ) {}

  async upload(): Promise<UploadOutcome> {
    this.uploadCalls += 1;
    return {
      status: "ok",
      metadata: {
        ...METADATA,
        providerAssetId: `${METADATA.providerAssetId}-${this.uploadCalls}`,
      },
    };
  }

  async lookup(): Promise<LookupOutcome> {
    this.lookupCalls += 1;
    return this.lookupOutcome;
  }

  async destroy(): Promise<boolean> {
    return true;
  }
}

const directories: string[] = [];

function freshRepository(): MediaRepository {
  const directory = mkdtempSync(join(tmpdir(), "resolver-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return new MediaRepository(database);
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

interface Harness {
  resolver: ReturnType<typeof importMediaResolver>;
  provider: StubProvider;
  repository: MediaRepository;
  diagnostics: ResolverDiagnostic[];
  fetched: string[];
  readPaths: string[];
}

function harness(
  overrides: {
    files?: Record<string, Uint8Array>;
    fetchOutcome?: FetchImageOutcome;
    lookupOutcome?: LookupOutcome;
  } = {}
): Harness {
  const provider = new StubProvider(overrides.lookupOutcome);
  const repository = freshRepository();
  const diagnostics: ResolverDiagnostic[] = [];
  const fetched: string[] = [];
  const readPaths: string[] = [];
  const files = overrides.files ?? {};

  const resolver = importMediaResolver({
    config: CONFIG,
    repository,
    provider,
    legacyCloudName: LEGACY_CLOUD,
    async readFile(path) {
      readPaths.push(path);
      return files[path] ?? null;
    },
    async fetchImage(url) {
      fetched.push(url);
      return (
        overrides.fetchOutcome ?? {
          status: "ok",
          bytes: pngBytes(9),
          contentType: "image/png",
        }
      );
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { resolver, provider, repository, diagnostics, fetched, readPaths };
}

describe("local references", () => {
  test("reads through the same mapping the site serves them with", async () => {
    const context = harness({
      files: { "src/public/avatar.webp": webpBytes() },
    });

    const resolved = await context.resolver.resolveLocal("/avatar.webp");

    expect(context.readPaths).toEqual(["src/public/avatar.webp"]);
    expect(resolved?.mediaAssetId).toBeString();
    expect(resolved?.shared).toBe(false);
    expect(context.provider.uploadCalls).toBe(1);
  });

  test("two references to identical bytes yield one asset", async () => {
    const context = harness({
      files: {
        "src/public/og.png": pngBytes(),
        "src/public/logo.png": pngBytes(),
      },
    });

    const first = await context.resolver.resolveLocal("/public/og.png");
    const second = await context.resolver.resolveLocal("/public/logo.png");

    expect(first?.mediaAssetId).toBe(second!.mediaAssetId);
    expect(second?.shared).toBe(true);
    expect(context.provider.uploadCalls).toBe(1);
  });

  test("a missing file resolves to null with a reason", async () => {
    const context = harness();

    expect(await context.resolver.resolveLocal("/public/gone.png")).toBeNull();
    expect(context.diagnostics).toEqual([
      {
        reference: "/public/gone.png",
        kind: "local",
        outcome: "rejected:local_file_not_found",
      },
    ]);
  });

  test("traversal is refused before anything is read", async () => {
    const context = harness();

    expect(
      await context.resolver.resolveLocal("/public/../../.env")
    ).toBeNull();
    expect(context.readPaths).toEqual([]);
    expect(context.diagnostics[0]?.outcome).toBe(
      "rejected:outside_public_directory"
    );
  });

  test("a file that is not an image is refused without an upload", async () => {
    const context = harness({
      files: {
        "src/public/logo.png": new TextEncoder().encode("not an image"),
      },
    });

    expect(await context.resolver.resolveLocal("/public/logo.png")).toBeNull();
    expect(context.provider.uploadCalls).toBe(0);
    expect(context.diagnostics[0]?.outcome).toContain("rejected:");
  });
});

describe("cloudinary references", () => {
  test("the configured cloud is verified through the provider, not re-uploaded", async () => {
    const context = harness({
      lookupOutcome: { status: "found", metadata: METADATA },
    });

    const url = `https://res.cloudinary.com/${CONFIG.cloudName}/image/upload/v1/already-ours.png`;
    const resolved = await context.resolver.resolveCloudinary(url);

    expect(resolved?.mediaAssetId).toBeString();
    expect(context.provider.uploadCalls).toBe(0);
    expect(context.fetched).toEqual([]);
    expect(context.diagnostics[0]?.outcome).toBe("imported");
  });

  test("the legacy cloud is fetched and re-uploaded under our own identity", async () => {
    const context = harness();

    const resolved = await context.resolver.resolveCloudinary(QUESTURIAN);

    expect(context.fetched).toEqual([QUESTURIAN]);
    expect(context.provider.uploadCalls).toBe(1);
    expect(resolved?.mediaAssetId).toBeString();

    // The record is ours, in our cloud, with the digest of what we fetched.
    const asset = context.repository.findById(resolved!.mediaAssetId);
    expect(asset?.status).toBe("ready");
    expect(asset?.providerPublicId).toStartWith("portfolio/");
    expect(asset?.digest).toBeString();
    expect(asset?.originalFilename).toBe("questura_rbayjx");
  });

  test("re-running the legacy adoption neither re-fetches nor re-uploads", async () => {
    const context = harness();

    const first = await context.resolver.resolveCloudinary(QUESTURIAN);
    const second = await context.resolver.resolveCloudinary(QUESTURIAN);

    expect(first?.mediaAssetId).toBe(second!.mediaAssetId);
    expect(second?.shared).toBe(true);
    expect(context.provider.uploadCalls).toBe(1);
    // Fetched twice — the bytes are how identity is established, so there is
    // nothing to compare against until they are in hand.
    expect(context.fetched.length).toBe(2);
  });

  test("a third-party cloud is refused without a fetch", async () => {
    const context = harness();

    const url =
      "https://res.cloudinary.com/somebody-elses-cloud/image/upload/v1/x.png";

    expect(await context.resolver.resolveCloudinary(url)).toBeNull();
    expect(context.fetched).toEqual([]);
    expect(context.diagnostics[0]?.outcome).toBe("rejected:unknown_cloud");
  });

  test("a non-Cloudinary URL is refused", async () => {
    const context = harness();

    expect(
      await context.resolver.resolveCloudinary("https://example.com/a.png")
    ).toBeNull();
    expect(context.diagnostics[0]?.outcome).toBe(
      "rejected:not_a_cloudinary_url"
    );
  });

  test("an unreachable legacy asset resolves to null rather than a placeholder", async () => {
    const context = harness({
      fetchOutcome: {
        status: "unavailable",
        reason: "legacy_asset_unreachable",
      },
    });

    expect(await context.resolver.resolveCloudinary(QUESTURIAN)).toBeNull();
    expect(context.provider.uploadCalls).toBe(0);
    expect(context.diagnostics[0]?.outcome).toBe(
      "unavailable:legacy_asset_unreachable"
    );
  });

  test("fetched bytes that are not an image are refused", async () => {
    const context = harness({
      fetchOutcome: {
        status: "ok",
        bytes: new TextEncoder().encode("<svg></svg>"),
        contentType: "image/png",
      },
    });

    expect(await context.resolver.resolveCloudinary(QUESTURIAN)).toBeNull();
    expect(context.provider.uploadCalls).toBe(0);
  });
});

/** A minimal still WebP: RIFF header, "WEBP", then a `VP8 ` chunk. */
function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([...new TextEncoder().encode("RIFF")], 0);
  bytes.set([...new TextEncoder().encode("WEBP")], 8);
  bytes.set([...new TextEncoder().encode("VP8 ")], 12);
  return bytes;
}
