import { dirname, join } from "node:path";
import { resolveDatabaseFile } from "../database/config";

const REQUIRED = [
  "RECOVERY_R2_ACCOUNT_ID",
  "RECOVERY_R2_BUCKET",
  "RECOVERY_R2_ACCESS_KEY_ID",
  "RECOVERY_R2_SECRET_ACCESS_KEY",
  "RECOVERY_AGE_OWNER_RECIPIENT",
  "RECOVERY_AGE_DRILL_RECIPIENT",
] as const;

export interface RecoveryConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  recipients: [string, string];
  databaseFile: string;
  stagingRoot: string;
  appCommit: string;
}

export type RecoveryConfigResolution =
  | { status: "configured"; config: RecoveryConfig }
  | { status: "unconfigured"; missing: string[] }
  | { status: "invalid"; reason: string };

function value(environment: NodeJS.ProcessEnv, name: string): string | null {
  const candidate = environment[name]?.trim();
  return candidate ? candidate : null;
}

export function resolveRecoveryConfig(
  environment: NodeJS.ProcessEnv = process.env
): RecoveryConfigResolution {
  const present = REQUIRED.filter((name) => value(environment, name));
  const missing = REQUIRED.filter((name) => !value(environment, name));
  if (present.length === 0) {
    return { status: "unconfigured", missing: [...missing] };
  }
  if (missing.length > 0) {
    return {
      status: "invalid",
      reason: `Recovery is partially configured; missing ${missing.join(", ")}`,
    };
  }

  const accountId = value(environment, "RECOVERY_R2_ACCOUNT_ID")!;
  const bucket = value(environment, "RECOVERY_R2_BUCKET")!;
  const ownerRecipient = value(environment, "RECOVERY_AGE_OWNER_RECIPIENT")!;
  const drillRecipient = value(environment, "RECOVERY_AGE_DRILL_RECIPIENT")!;

  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    return {
      status: "invalid",
      reason: "RECOVERY_R2_ACCOUNT_ID must be a 32-character account id",
    };
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    return { status: "invalid", reason: "RECOVERY_R2_BUCKET is invalid" };
  }
  if (
    !/^age1[0-9a-z]+$/.test(ownerRecipient) ||
    !/^age1[0-9a-z]+$/.test(drillRecipient)
  ) {
    return {
      status: "invalid",
      reason: "Recovery age recipients must be public age1 keys",
    };
  }
  if (ownerRecipient === drillRecipient) {
    return {
      status: "invalid",
      reason: "Owner and drill age recipients must be different keys",
    };
  }

  let databaseFile: string;
  try {
    databaseFile = resolveDatabaseFile(environment);
  } catch (error) {
    return {
      status: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const stagingRoot =
    value(environment, "RECOVERY_STAGING_ROOT") ??
    join(dirname(databaseFile), "recovery-staging");
  const appCommit =
    value(environment, "RAILWAY_GIT_COMMIT_SHA") ??
    value(environment, "GITHUB_SHA") ??
    "development";

  return {
    status: "configured",
    config: {
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      bucket,
      accessKeyId: value(environment, "RECOVERY_R2_ACCESS_KEY_ID")!,
      secretAccessKey: value(environment, "RECOVERY_R2_SECRET_ACCESS_KEY")!,
      recipients: [ownerRecipient, drillRecipient],
      databaseFile,
      stagingRoot,
      appCommit,
    },
  };
}

export function validateRecoveryConfigAtStartup(): void {
  const resolution = resolveRecoveryConfig();
  if (resolution.status === "invalid") {
    throw new Error(`Recovery misconfigured: ${resolution.reason}`);
  }
}
