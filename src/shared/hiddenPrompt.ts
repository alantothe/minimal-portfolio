export interface HiddenPromptIO {
  ask(question: string): Promise<string>;
  setEcho(enabled: boolean): void;
  write(text: string): void;
}

export async function readHiddenInput(
  question: string,
  io: HiddenPromptIO
): Promise<string> {
  io.setEcho(false);
  try {
    return await io.ask(question);
  } finally {
    io.setEcho(true);
    io.write("\n");
  }
}
