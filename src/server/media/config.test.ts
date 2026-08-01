import { afterEach, describe, expect, test } from "bun:test";
import { resolveMediaConfig, validateMediaConfigAtStartup } from "./config";

const KEYS = [
  "MEDIA_PROVIDER",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "MEDIA_MAX_UPLOAD_BYTES",
  "NODE_ENV",
] as const;

const original = new Map(KEYS.map((key) => [key, process.env[key]]));

function withEnvironment(values: Partial<Record<string, string>>): void {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const VALID = {
  MEDIA_PROVIDER: "cloudinary",
  CLOUDINARY_CLOUD_NAME: "example-cloud",
  CLOUDINARY_API_KEY: "123456789012345",
  CLOUDINARY_API_SECRET: "s".repeat(27),
};

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("media configuration", () => {
  test("resolves a complete Cloudinary configuration", () => {
    withEnvironment(VALID);

    const resolution = resolveMediaConfig();

    expect(resolution.status).toBe("configured");
    if (resolution.status !== "configured") return;
    expect(resolution.config.cloudName).toBe("example-cloud");
    expect(resolution.config.maxUploadBytes).toBe(10_000_000);
  });

  test("treats a site with no media provider as unconfigured", () => {
    withEnvironment({});

    expect(resolveMediaConfig().status).toBe("unconfigured");
  });

  test("treats a half-configured provider as invalid", () => {
    withEnvironment({
      CLOUDINARY_CLOUD_NAME: VALID.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: VALID.CLOUDINARY_API_KEY,
    });

    const resolution = resolveMediaConfig();

    expect(resolution.status).toBe("invalid");
    if (resolution.status !== "invalid") return;
    expect(resolution.reason).toContain("CLOUDINARY_API_SECRET");
  });

  test("rejects an unknown provider rather than assuming Cloudinary", () => {
    withEnvironment({ ...VALID, MEDIA_PROVIDER: "imgur" });

    const resolution = resolveMediaConfig();

    expect(resolution.status).toBe("invalid");
    if (resolution.status !== "invalid") return;
    expect(resolution.reason).toContain("imgur");
  });

  test("rejects a placeholder secret", () => {
    withEnvironment({
      ...VALID,
      CLOUDINARY_API_SECRET: "<your-api-secret>",
    });

    expect(resolveMediaConfig().status).toBe("invalid");
  });

  test.each(["0", "-1", "10mb", "1e7"])("rejects upload limit %p", (limit) => {
    withEnvironment({ ...VALID, MEDIA_MAX_UPLOAD_BYTES: limit });

    expect(resolveMediaConfig().status).toBe("invalid");
  });

  test("accepts an explicit upload limit", () => {
    withEnvironment({ ...VALID, MEDIA_MAX_UPLOAD_BYTES: "5000000" });

    const resolution = resolveMediaConfig();

    expect(resolution.status).toBe("configured");
    if (resolution.status !== "configured") return;
    expect(resolution.config.maxUploadBytes).toBe(5_000_000);
  });

  test("absent media configuration is tolerated even in production", () => {
    withEnvironment({ NODE_ENV: "production" });

    expect(() => validateMediaConfigAtStartup()).not.toThrow();
  });

  test("contradictory configuration is fatal everywhere", () => {
    withEnvironment({ CLOUDINARY_CLOUD_NAME: VALID.CLOUDINARY_CLOUD_NAME });

    expect(() => validateMediaConfigAtStartup()).toThrow("misconfigured");
  });
});
