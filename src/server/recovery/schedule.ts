import type { BackupKind, BackupResult, RecoveryStatus } from "./recovery";

const HOUR_MS = 60 * 60 * 1_000;

interface ScheduledRecovery {
  status(): RecoveryStatus;
  checkpoint(
    kind: BackupKind,
    options?: { changeId?: string }
  ): Promise<BackupResult>;
}

interface TimerDependencies {
  clock: () => Date;
  setInterval: (callback: () => void, milliseconds: number) => TimerHandle;
  clearInterval: (timer: TimerHandle) => void;
  reconcileMedia?: () => Promise<unknown>;
  publicationRetryDelaysMs: number[];
}

interface TimerHandle {
  unref?(): void;
}

function reportFailure(scope: string, error: unknown): void {
  // Stable event only. External SDK and filesystem errors may contain bucket
  // names or paths, so raw messages never enter production logs.
  console.error(`[recovery] ${scope}_failed`);
  if (process.env.NODE_ENV !== "production") {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

export class RecoveryScheduler {
  private readonly timers: TimerDependencies;
  private timer: TimerHandle | null = null;

  constructor(
    private readonly coordinator: ScheduledRecovery,
    timers: Partial<TimerDependencies> = {}
  ) {
    this.timers = {
      clock: timers.clock ?? (() => new Date()),
      setInterval:
        timers.setInterval ??
        ((callback, milliseconds) =>
          globalThis.setInterval(callback, milliseconds) as TimerHandle),
      clearInterval:
        timers.clearInterval ??
        ((timer) => globalThis.clearInterval(timer as never)),
      reconcileMedia: timers.reconcileMedia,
      publicationRetryDelaysMs: timers.publicationRetryDelaysMs ?? [
        0, 30_000, 90_000, 180_000,
      ],
    };
  }

  start(): void {
    if (this.timer !== null) return;
    if (this.coordinator.status().alerts.includes("backup_overdue")) {
      void this.coordinator
        .checkpoint("hourly")
        .catch((error) => reportFailure("startup_backup", error));
    }
    if (
      this.timers.reconcileMedia &&
      this.coordinator.status().alerts.includes("media_original_overdue")
    ) {
      void this.timers
        .reconcileMedia()
        .catch((error) => reportFailure("startup_media_reconciliation", error));
    }
    this.timer = this.timers.setInterval(() => {
      void this.runScheduled().catch((error) =>
        reportFailure("scheduled_backup", error)
      );
    }, HOUR_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  async runScheduled(): Promise<void> {
    const now = this.timers.clock();
    await this.coordinator.checkpoint("hourly");
    if (now.getUTCHours() === 0) {
      await this.coordinator.checkpoint("daily");
      await this.timers.reconcileMedia?.();
      if (now.getUTCDate() === 1) {
        await this.coordinator.checkpoint("monthly");
      }
    }
  }

  afterPublication(): void {
    void this.checkpointWithRetry("hourly", "publication_backup");
  }

  private async checkpointWithRetry(
    kind: BackupKind,
    scope: string
  ): Promise<void> {
    const delays = this.timers.publicationRetryDelaysMs;
    let lastError: unknown;
    for (const delay of delays) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      try {
        await this.coordinator.checkpoint(kind);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    reportFailure(scope, lastError);
  }
}
