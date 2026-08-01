import { afterEach, describe, expect, test } from "bun:test";
import { resolveAuthConfig, validateAuthConfigAtStartup } from "./config";

const AUTH_VARIABLES = [
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GITHUB_OWNER_ID",
  "SITE_URL",
  "NODE_ENV",
] as const;

const originalEnvironment = new Map(
  AUTH_VARIABLES.map((name) => [name, process.env[name]])
);

/**
 * The developer running these tests has real values in `.env`, which Bun loads
 * automatically. Every test therefore states the whole environment it needs
 * rather than inheriting one, so results do not depend on whose machine it is.
 */
function withEnvironment(values: Partial<Record<string, string>>): void {
  for (const name of AUTH_VARIABLES) {
    const value = values[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

const VALID = {
  GITHUB_OAUTH_CLIENT_ID: "Ov23liExampleClientId",
  GITHUB_OAUTH_CLIENT_SECRET: "0".repeat(40),
  GITHUB_OWNER_ID: "104442054",
  SITE_URL: "https://example.test",
};

afterEach(() => {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("owner authentication configuration", () => {
  test("derives the callback URI from SITE_URL", () => {
    withEnvironment(VALID);

    const resolution = resolveAuthConfig();

    expect(resolution.status).toBe("configured");
    if (resolution.status !== "configured") return;
    expect(resolution.config.origin).toBe("https://example.test");
    expect(resolution.config.callbackUrl).toBe(
      "https://example.test/admin/auth/github/callback"
    );
    expect(resolution.config.ownerId).toBe(104442054);
  });

  test("reports an entirely absent OAuth App as unconfigured", () => {
    withEnvironment({ SITE_URL: VALID.SITE_URL });

    const resolution = resolveAuthConfig();

    expect(resolution.status).toBe("unconfigured");
  });

  test("treats a partially configured OAuth App as invalid", () => {
    withEnvironment({
      SITE_URL: VALID.SITE_URL,
      GITHUB_OAUTH_CLIENT_ID: VALID.GITHUB_OAUTH_CLIENT_ID,
    });

    const resolution = resolveAuthConfig();

    expect(resolution.status).toBe("invalid");
    if (resolution.status !== "invalid") return;
    expect(resolution.reason).toContain("GITHUB_OAUTH_CLIENT_SECRET");
  });

  test.each([
    ["<your-client-secret>", "placeholder"],
    ["changeme", "placeholder"],
  ])("rejects placeholder secret %p", (secret) => {
    withEnvironment({ ...VALID, GITHUB_OAUTH_CLIENT_SECRET: secret });

    const resolution = resolveAuthConfig();

    expect(resolution.status).toBe("invalid");
  });

  test.each(["0", "-1", "12.5", "alantothe", "0x1a", "1e9"])(
    "rejects owner id %p",
    (ownerId) => {
      withEnvironment({ ...VALID, GITHUB_OWNER_ID: ownerId });

      const resolution = resolveAuthConfig();

      expect(resolution.status).toBe("invalid");
    }
  );

  test("tolerates surrounding whitespace in configured values", () => {
    withEnvironment({ ...VALID, GITHUB_OWNER_ID: " 104442054 " });

    const resolution = resolveAuthConfig();

    expect(resolution.status).toBe("configured");
    if (resolution.status !== "configured") return;
    expect(resolution.config.ownerId).toBe(104442054);
  });

  test("allows http only for loopback, so __Host- cookies still apply locally", () => {
    withEnvironment({ ...VALID, SITE_URL: "http://localhost:8000" });
    expect(resolveAuthConfig().status).toBe("configured");

    withEnvironment({ ...VALID, SITE_URL: "http://portfolio.example" });
    expect(resolveAuthConfig().status).toBe("invalid");
  });

  test("startup fails when production has no OAuth App", () => {
    withEnvironment({ SITE_URL: VALID.SITE_URL, NODE_ENV: "production" });

    expect(() => validateAuthConfigAtStartup()).toThrow(
      "requires GITHUB_OAUTH_CLIENT_ID"
    );
  });

  test("startup tolerates an unconfigured OAuth App outside production", () => {
    withEnvironment({ SITE_URL: VALID.SITE_URL });

    expect(() => validateAuthConfigAtStartup()).not.toThrow();
  });

  test("startup fails on misconfiguration in every environment", () => {
    withEnvironment({
      SITE_URL: VALID.SITE_URL,
      GITHUB_OAUTH_CLIENT_ID: VALID.GITHUB_OAUTH_CLIENT_ID,
    });

    expect(() => validateAuthConfigAtStartup()).toThrow("misconfigured");
  });
});
