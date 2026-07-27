import { describe, expect, test } from "bun:test";
import { parsePort } from "./config";

describe("server configuration", () => {
  test.each([
    [undefined, 8000],
    ["8000", 8000],
    ["443", 443],
    ["65535", 65535],
  ])("parses valid port %p", (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });

  test.each(["", "0", "65536", "12.5", "not-a-port"])(
    "rejects invalid port %p",
    value => {
      expect(() => parsePort(value)).toThrow("PORT");
    },
  );

  test("production start enforces canonical configuration", async () => {
    const subprocess = Bun.spawn(["bun", "run", "start"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: "8130",
        SITE_URL: "http://example.com",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(`${stdout}\n${stderr}`).toContain("SITE_URL");
  });
});
