import { createInterface } from "node:readline/promises";

export interface HiddenPromptIO {
  input: NodeJS.ReadableStream;
  setEcho(enabled: boolean): void;
  write(text: string): void;
}

export async function readHiddenInput(
  question: string,
  io: HiddenPromptIO
): Promise<string> {
  io.setEcho(false);
  io.write(question);
  const lines = createInterface({
    input: io.input,
    terminal: false,
  });
  try {
    for await (const line of lines) {
      return line.trim();
    }
    throw new Error("Secret entry was cancelled.");
  } finally {
    lines.close();
    io.setEcho(true);
    io.write("\n");
  }
}
