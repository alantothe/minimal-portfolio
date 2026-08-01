import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./connection";
import { runMigrations } from "./migrator";
import { OwnerAuthRepository } from "./authRepository";
import {
  ABSOLUTE_TTL_SECONDS,
  ATTEMPT_TTL_SECONDS,
  IDLE_TTL_SECONDS,
  TOUCH_INTERVAL_SECONDS,
} from "../auth/policy";

const temporaryDirectories: string[] = [];

function migratedDatabase(): Database {
  const directory = mkdtempSync(join(tmpdir(), "owner-auth-db-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "content.sqlite"));
  runMigrations(database);
  return database;
}

function repository(): OwnerAuthRepository {
  return new OwnerAuthRepository(migratedDatabase());
}

const NOW = new Date("2026-07-31T12:00:00.000Z");

function secondsLater(seconds: number, from: Date = NOW): Date {
  return new Date(from.getTime() + seconds * 1000);
}

const ATTEMPT = {
  attemptTokenDigest: "attempt-digest",
  stateDigest: "state-digest",
  pkceVerifier: "pkce-verifier",
};

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("OAuth attempts", () => {
  test("returns the PKCE verifier when both halves match", () => {
    const repo = repository();
    repo.createAttempt(ATTEMPT, NOW);

    expect(
      repo.consumeAttempt(ATTEMPT.attemptTokenDigest, ATTEMPT.stateDigest, NOW)
    ).toBe("pkce-verifier");
  });

  test("cannot be consumed twice, so a replayed state is refused", () => {
    const repo = repository();
    repo.createAttempt(ATTEMPT, NOW);

    repo.consumeAttempt(ATTEMPT.attemptTokenDigest, ATTEMPT.stateDigest, NOW);

    expect(
      repo.consumeAttempt(ATTEMPT.attemptTokenDigest, ATTEMPT.stateDigest, NOW)
    ).toBeNull();
  });

  test("refuses a valid state presented by a different browser", () => {
    const repo = repository();
    repo.createAttempt(ATTEMPT, NOW);

    expect(
      repo.consumeAttempt("someone-elses-cookie", ATTEMPT.stateDigest, NOW)
    ).toBeNull();
  });

  test("refuses the right cookie with a state from another attempt", () => {
    const repo = repository();
    repo.createAttempt(ATTEMPT, NOW);

    expect(
      repo.consumeAttempt(ATTEMPT.attemptTokenDigest, "other-state", NOW)
    ).toBeNull();
  });

  test("expires after its time-to-live", () => {
    const repo = repository();
    repo.createAttempt(ATTEMPT, NOW);

    const justAfter = secondsLater(ATTEMPT_TTL_SECONDS + 1);

    expect(
      repo.consumeAttempt(
        ATTEMPT.attemptTokenDigest,
        ATTEMPT.stateDigest,
        justAfter
      )
    ).toBeNull();
  });

  test("sweeps expired attempts when a later one is recorded", () => {
    const database = migratedDatabase();
    const repo = new OwnerAuthRepository(database);
    repo.createAttempt(ATTEMPT, NOW);

    repo.createAttempt(
      { ...ATTEMPT, attemptTokenDigest: "b", stateDigest: "b" },
      secondsLater(ATTEMPT_TTL_SECONDS + 1)
    );

    const remaining = database
      .query("SELECT COUNT(*) AS count FROM oauth_attempts")
      .get() as { count: number };
    expect(remaining.count).toBe(1);
  });
});

describe("owner sessions", () => {
  const SESSION = {
    tokenDigest: "session-digest",
    githubUserId: 104442054,
    csrfToken: "csrf",
  };

  test("is found while active", () => {
    const repo = repository();
    repo.createSession(SESSION, NOW);

    expect(repo.findActiveSession(SESSION.tokenDigest, NOW)?.githubUserId).toBe(
      104442054
    );
  });

  test("signing in again revokes the previous session", () => {
    const repo = repository();
    repo.createSession(SESSION, NOW);

    repo.createSession({ ...SESSION, tokenDigest: "second" }, NOW);

    expect(repo.findActiveSession(SESSION.tokenDigest, NOW)).toBeNull();
    expect(repo.findActiveSession("second", NOW)).not.toBeNull();
  });

  test("ends after the idle timeout", () => {
    const repo = repository();
    repo.createSession(SESSION, NOW);

    const idle = secondsLater(IDLE_TTL_SECONDS + 1);

    expect(repo.findActiveSession(SESSION.tokenDigest, idle)).toBeNull();
  });

  test("activity pushes the idle deadline forward", () => {
    const repo = repository();
    repo.createSession(SESSION, NOW);

    const later = secondsLater(TOUCH_INTERVAL_SECONDS + 60);
    repo.touchSession(SESSION.tokenDigest, later);

    const wouldHaveExpired = secondsLater(IDLE_TTL_SECONDS + 1);
    expect(
      repo.findActiveSession(SESSION.tokenDigest, wouldHaveExpired)
    ).not.toBeNull();
  });

  test("skips the write when last seen only moments ago", () => {
    const repo = repository();
    const created = repo.createSession(SESSION, NOW);

    repo.touchSession(SESSION.tokenDigest, secondsLater(30));

    const session = repo.findActiveSession(SESSION.tokenDigest, NOW);
    expect(session?.lastSeenAt).toBe(created.lastSeenAt);
  });

  test("activity never extends the absolute deadline", () => {
    const repo = repository();
    const created = repo.createSession(SESSION, NOW);

    // Stay active right up to the ceiling.
    for (
      let elapsed = TOUCH_INTERVAL_SECONDS + 1;
      elapsed < ABSOLUTE_TTL_SECONDS;
      elapsed += TOUCH_INTERVAL_SECONDS + 1
    ) {
      repo.touchSession(SESSION.tokenDigest, secondsLater(elapsed));
    }

    const afterCeiling = secondsLater(ABSOLUTE_TTL_SECONDS + 1);
    expect(
      repo.findActiveSession(SESSION.tokenDigest, afterCeiling)
    ).toBeNull();
    expect(
      repo.findActiveSession(
        SESSION.tokenDigest,
        secondsLater(ABSOLUTE_TTL_SECONDS - 1)
      )?.absoluteExpiresAt
    ).toBe(created.absoluteExpiresAt);
  });

  test("revoking ends the session immediately", () => {
    const repo = repository();
    repo.createSession(SESSION, NOW);

    repo.revokeSession(SESSION.tokenDigest, NOW);

    expect(repo.findActiveSession(SESSION.tokenDigest, NOW)).toBeNull();
  });

  test("touching a revoked session does not resurrect it", () => {
    const repo = repository();
    repo.createSession(SESSION, NOW);
    repo.revokeSession(SESSION.tokenDigest, NOW);

    repo.touchSession(
      SESSION.tokenDigest,
      secondsLater(TOUCH_INTERVAL_SECONDS + 60)
    );

    expect(
      repo.findActiveSession(SESSION.tokenDigest, secondsLater(600))
    ).toBeNull();
  });
});
