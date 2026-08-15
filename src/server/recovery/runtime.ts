import type { Database } from "bun:sqlite";
import { getDatabase } from "../database";
import type { RecoveryCipher, RecoveryObjectStore } from "./recovery";
import { RecoveryCoordinator } from "./recovery";
import { AgeCipher, R2ObjectStore } from "./adapters";
import { resolveRecoveryConfig } from "./config";
import { RecoveryScheduler } from "./schedule";
import { resolveMediaConfig } from "../media/config";
import { CloudinaryOriginalSource } from "./mediaSource";

export type RecoveryRuntimeStatus =
  | {
      status: "unconfigured";
      alerts: ["recovery_unconfigured"];
      gatesReadiness: false;
    }
  | {
      status: "configured";
      alerts: string[];
      lastSuccessfulBackupAt: string | null;
      lastSuccessfulDrillAt: string | null;
      unprotectedMedia: number;
      running: boolean;
      queued: number;
      gatesReadiness: false;
    };

interface RuntimeState {
  coordinator: RecoveryCoordinator;
  scheduler: RecoveryScheduler;
}

let state: RuntimeState | null = null;

interface InitializeOptions {
  environment?: NodeJS.ProcessEnv;
  store?: RecoveryObjectStore;
  cipher?: RecoveryCipher;
  startScheduler?: boolean;
}

export function initializeRecovery(options: InitializeOptions = {}): void {
  closeRecovery();
  const resolution = resolveRecoveryConfig(options.environment);
  if (resolution.status === "invalid") {
    throw new Error(`Recovery misconfigured: ${resolution.reason}`);
  }
  if (resolution.status === "unconfigured") {
    console.warn("[recovery] unconfigured");
    return;
  }

  const { config } = resolution;
  const coordinator = new RecoveryCoordinator({
    database: getDatabase(),
    databaseFile: config.databaseFile,
    stagingRoot: config.stagingRoot,
    store:
      options.store ??
      new R2ObjectStore({
        endpoint: config.endpoint,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      }),
    cipher: options.cipher ?? new AgeCipher(),
    recipients: config.recipients,
    appCommit: config.appCommit,
  });
  const media = resolveMediaConfig();
  const scheduler = new RecoveryScheduler(coordinator, {
    reconcileMedia:
      media.status === "configured"
        ? () =>
            coordinator.reconcileMediaOriginals(
              new CloudinaryOriginalSource(
                media.config.cloudName,
                media.config.maxUploadBytes
              )
            )
        : undefined,
  });
  state = { coordinator, scheduler };
  if (options.startScheduler !== false) scheduler.start();
  console.log("[recovery] configured");
}

export function closeRecovery(): void {
  state?.scheduler.stop();
  state = null;
}

export function getRecoveryCoordinator(): RecoveryCoordinator | null {
  return state?.coordinator ?? null;
}

export function recoveryRuntimeStatus(): RecoveryRuntimeStatus {
  if (!state) {
    return {
      status: "unconfigured",
      alerts: ["recovery_unconfigured"],
      gatesReadiness: false,
    };
  }
  const status = state.coordinator.status();
  return {
    status: "configured",
    alerts: status.alerts,
    lastSuccessfulBackupAt: status.lastSuccessfulBackupAt,
    lastSuccessfulDrillAt: status.lastSuccessfulDrillAt,
    unprotectedMedia: status.unprotectedMediaIds.length,
    running: status.running,
    queued: status.queued,
    gatesReadiness: false,
  };
}

export function requestPublicationCheckpoint(): void {
  state?.scheduler.afterPublication();
}

export function requestChangeCheckpoint(changeId: string): void {
  void state?.coordinator
    .checkpoint("pre-change", { changeId })
    .catch((error) => {
      console.error("[recovery] change_checkpoint_failed");
      if (process.env.NODE_ENV !== "production") {
        console.error(error instanceof Error ? error.message : String(error));
      }
    });
}

export function createConfiguredCoordinator(
  database: Database,
  databaseFile: string
): RecoveryCoordinator | null {
  const resolution = resolveRecoveryConfig();
  if (resolution.status === "unconfigured") return null;
  if (resolution.status === "invalid") {
    throw new Error(`Recovery misconfigured: ${resolution.reason}`);
  }
  const { config } = resolution;
  return new RecoveryCoordinator({
    database,
    databaseFile,
    stagingRoot: config.stagingRoot,
    store: new R2ObjectStore({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    }),
    cipher: new AgeCipher(),
    recipients: config.recipients,
    appCommit: config.appCommit,
  });
}
