import { describe, expect, test } from "bun:test";
import { resolveRecoveryConfig } from "./config";

const COMPLETE = {
  RECOVERY_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  RECOVERY_R2_BUCKET: "minimal-portfolio-recovery",
  RECOVERY_R2_ACCESS_KEY_ID: "access-key",
  RECOVERY_R2_SECRET_ACCESS_KEY: "secret-key",
  RECOVERY_AGE_OWNER_RECIPIENT: "age1ownerrecipient",
  RECOVERY_AGE_DRILL_RECIPIENT: "age1drillrecipient",
  CONTENT_DATABASE_FILE: "/data/content.sqlite",
  RAILWAY_GIT_COMMIT_SHA: "abc1234",
};

describe("recovery configuration", () => {
  test("is optional only when every recovery variable is absent", () => {
    expect(resolveRecoveryConfig({}).status).toBe("unconfigured");
    expect(resolveRecoveryConfig({ RECOVERY_R2_BUCKET: "partial" })).toEqual({
      status: "invalid",
      reason:
        "Recovery is partially configured; missing RECOVERY_R2_ACCOUNT_ID, RECOVERY_R2_ACCESS_KEY_ID, RECOVERY_R2_SECRET_ACCESS_KEY, RECOVERY_AGE_OWNER_RECIPIENT, RECOVERY_AGE_DRILL_RECIPIENT",
    });
  });

  test("resolves private R2 and two distinct public age recipients", () => {
    expect(resolveRecoveryConfig(COMPLETE)).toEqual({
      status: "configured",
      config: {
        endpoint:
          "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        bucket: "minimal-portfolio-recovery",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        recipients: ["age1ownerrecipient", "age1drillrecipient"],
        databaseFile: "/data/content.sqlite",
        stagingRoot: "/data/recovery-staging",
        appCommit: "abc1234",
      },
    });
  });

  test("refuses one key reused for owner and automated drill", () => {
    const resolution = resolveRecoveryConfig({
      ...COMPLETE,
      RECOVERY_AGE_DRILL_RECIPIENT: COMPLETE.RECOVERY_AGE_OWNER_RECIPIENT,
    });

    expect(resolution).toEqual({
      status: "invalid",
      reason: "Owner and drill age recipients must be different keys",
    });
  });

  test("never accepts private age identities in runtime configuration", () => {
    const resolution = resolveRecoveryConfig({
      ...COMPLETE,
      RECOVERY_AGE_OWNER_RECIPIENT: "AGE-SECRET-KEY-1OWNER",
    });

    expect(resolution).toEqual({
      status: "invalid",
      reason: "Recovery age recipients must be public age1 keys",
    });
  });
});
