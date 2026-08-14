import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { readHiddenInput } from "./hiddenPrompt";

test("keeps the question visible without echoing hidden input", async () => {
  const input = new PassThrough();
  const events: string[] = [];
  input.end("secret-value\n");

  const value = await readHiddenInput("API key (hidden): ", {
    input,
    setEcho: (enabled) => events.push(`echo:${enabled}`),
    write: (text) => events.push(`write:${JSON.stringify(text)}`),
  });

  expect(value).toBe("secret-value");
  expect(events).toEqual([
    "echo:false",
    'write:"API key (hidden): "',
    "echo:true",
    'write:"\\n"',
  ]);
  expect(events.join("\n")).not.toContain("secret-value");
});
