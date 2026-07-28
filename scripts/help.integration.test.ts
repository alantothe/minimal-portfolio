import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const decoder = new TextDecoder();
const projectRoot = resolve(import.meta.dir, "..");

describe("project help command", () => {
  test("explains the complete local-to-production workflow", () => {
    const result = Bun.spawnSync(["bun", "run", "help"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = decoder.decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output).toContain("bun run dev");
    expect(output).toContain('bun run work:start "change description"');
    expect(output).toContain("bun run work:submit");
    expect(output).toContain("Squash and merge");
    expect(output).toContain("Railway deploys production");
    expect(output).toContain("bun run work:finish");

    expect(output.indexOf("bun run dev")).toBeLessThan(
      output.indexOf("bun run work:submit")
    );
    expect(output.indexOf("bun run work:submit")).toBeLessThan(
      output.indexOf("Railway deploys production")
    );
  });
});
