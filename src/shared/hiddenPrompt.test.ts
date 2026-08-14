import { expect, test } from "bun:test";
import { readHiddenInput } from "./hiddenPrompt";

test("keeps the hidden-input question visible while readline waits", async () => {
  const events: string[] = [];

  const value = await readHiddenInput("API key (hidden): ", {
    ask: async (question) => {
      events.push(`ask:${question}`);
      return "secret-value";
    },
    setEcho: (enabled) => events.push(`echo:${enabled}`),
    write: (text) => events.push(`write:${JSON.stringify(text)}`),
  });

  expect(value).toBe("secret-value");
  expect(events).toEqual([
    "echo:false",
    "ask:API key (hidden): ",
    "echo:true",
    'write:"\\n"',
  ]);
});
