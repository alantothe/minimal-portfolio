import { describe, expect, test } from "bun:test";
import type { BackupKind, BackupResult, RecoveryStatus } from "./recovery";
import { RecoveryScheduler } from "./schedule";

function schedulerFixture(overdue = false) {
  const checkpoints: BackupKind[] = [];
  const coordinator = {
    status(): RecoveryStatus {
      return {
        running: false,
        queued: 0,
        lastSuccessfulBackupAt: overdue ? null : "2026-08-14T11:00:00.000Z",
        lastSuccessfulDrillAt: "2026-08-10T00:00:00.000Z",
        unprotectedMediaIds: [],
        alerts: overdue ? ["backup_overdue"] : [],
      };
    },
    async checkpoint(kind: BackupKind): Promise<BackupResult> {
      checkpoints.push(kind);
      return {
        objectKey: kind,
        bundleDigest: "digest",
        publicationGeneration: 1,
        publishedFingerprint: "generation",
        mediaReferences: [],
        createdAt: "2026-08-14T12:00:00.000Z",
      };
    },
  };
  return { checkpoints, coordinator };
}

describe("RecoveryScheduler", () => {
  test("backs up on startup when hourly recovery point is overdue", async () => {
    const { checkpoints, coordinator } = schedulerFixture(true);
    const scheduler = new RecoveryScheduler(coordinator, {
      clock: () => new Date("2026-08-14T12:00:00.000Z"),
      setInterval: () => ({ unref() {} }) as NodeJS.Timeout,
      clearInterval() {},
    });

    scheduler.start();
    await Bun.sleep(0);

    expect(checkpoints).toEqual(["hourly"]);
  });

  test("creates hourly, daily, and monthly points at UTC month boundary", async () => {
    const { checkpoints, coordinator } = schedulerFixture();
    let reconciliations = 0;
    const scheduler = new RecoveryScheduler(coordinator, {
      clock: () => new Date("2026-09-01T00:00:00.000Z"),
      reconcileMedia: async () => {
        reconciliations += 1;
      },
    });

    await scheduler.runScheduled();

    expect(checkpoints).toEqual(["hourly", "daily", "monthly"]);
    expect(reconciliations).toBe(1);
  });

  test("requests a non-blocking checkpoint after Publication", async () => {
    const { checkpoints, coordinator } = schedulerFixture();
    const scheduler = new RecoveryScheduler(coordinator);

    scheduler.afterPublication();
    await Bun.sleep(0);

    expect(checkpoints).toEqual(["hourly"]);
  });

  test("retries a failed Publication checkpoint inside the five-minute RPO", async () => {
    const { checkpoints, coordinator } = schedulerFixture();
    let attempts = 0;
    coordinator.checkpoint = async (kind: BackupKind) => {
      checkpoints.push(kind);
      attempts += 1;
      if (attempts < 3) throw new Error("object storage unavailable");
      return {
        objectKey: kind,
        bundleDigest: "digest",
        publicationGeneration: 1,
        publishedFingerprint: "generation",
        mediaReferences: [],
        createdAt: "2026-08-14T12:00:00.000Z",
      };
    };
    const scheduler = new RecoveryScheduler(coordinator, {
      publicationRetryDelaysMs: [0, 0, 0],
    });

    scheduler.afterPublication();
    await Bun.sleep(20);

    expect(checkpoints).toEqual(["hourly", "hourly", "hourly"]);
  });
});
