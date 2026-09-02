import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migratedDatabase,
  seedPublishedSite,
} from "../src/server/published/fixtures";

const script = join(import.meta.dir, "pull-production-database.ts");
const directories: string[] = [];
const databases: Database[] = [];
const decoder = new TextDecoder();

afterEach(async () => {
  while (databases.length > 0) databases.pop()!.close();
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

describe("production database export command", () => {
  test("refuses production export outside production", () => {
    const result = Bun.spawnSync(
      [process.execPath, script, "export-production", "a".repeat(32)],
      {
        env: { ...process.env, NODE_ENV: "development" },
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    expect(result.exitCode).toBe(1);
    expect(decoder.decode(result.stderr)).toContain(
      "Production snapshot export requires NODE_ENV=production"
    );
  });

  test("writes sanitized snapshot only under local-pulls directory", () => {
    const fixture = migratedDatabase();
    directories.push(fixture.directory);
    databases.push(fixture.database);
    seedPublishedSite(fixture.database);
    const token = "b".repeat(32);
    const result = Bun.spawnSync(
      [process.execPath, script, "export-production", token],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          CONTENT_DATABASE_FILE: join(fixture.directory, "content.sqlite"),
        },
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decoder.decode(result.stdout))).toMatchObject({
      status: "ready",
      invalidatedSessions: 0,
      invalidatedOauthAttempts: 0,
    });
    expect(
      Bun.file(
        join(fixture.directory, ".local-pulls", `${token}.sqlite`)
      ).exists()
    ).resolves.toBe(true);
  });

  test("does not misreport a remote command failure as missing SSH auth", async () => {
    const fakeBin = await mkdtemp(join(tmpdir(), "fake-railway-"));
    directories.push(fakeBin);
    const railway = join(fakeBin, "railway");
    const lsof = join(fakeBin, "lsof");
    await writeFile(
      railway,
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "volume" && args.includes("list")) {
  console.log(JSON.stringify({
    volumes: [{ id: "volume-id", mountPath: "/data", status: "Ready" }],
  }));
} else if (args[0] === "ssh") {
  console.error("Using SSH key from agent: test@example.com");
  console.error('error: Module not found "scripts/pull-production-database.ts"');
  process.exit(1);
}
`
    );
    await writeFile(lsof, "#!/bin/sh\nexit 1\n");
    await Promise.all([chmod(railway, 0o700), chmod(lsof, 0o700)]);

    const result = Bun.spawnSync([process.execPath, script], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = decoder.decode(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(
      'error: Module not found "scripts/pull-production-database.ts"'
    );
    expect(stderr).not.toContain("railway ssh keys add");
  });
});
