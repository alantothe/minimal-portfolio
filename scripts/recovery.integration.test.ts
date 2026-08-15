import { describe, expect, test } from "bun:test";

describe("recovery operator command", () => {
  test("documents bounded commands without reading configuration", async () => {
    const process = Bun.spawn(["bun", "scripts/recovery.ts", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("checkpoint");
    expect(stderr).toContain("drill-latest");
    expect(stderr).toContain("fixture-drill");
    expect(stderr).not.toContain("SECRET");
  });
});
