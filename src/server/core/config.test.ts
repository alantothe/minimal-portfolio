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
});
