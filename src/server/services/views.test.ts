import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonViewStore } from "./views";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "minimal-portfolio-views-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "views.json");

  return {
    filePath,
    store: new JsonViewStore(filePath),
  };
}

describe("JSON view storage", () => {
  test("serializes concurrent increments without losing views", async () => {
    const { filePath, store } = await createStore();

    await Promise.all(
      Array.from({ length: 25 }, () => store.increment("example-post")),
    );

    expect(await store.get("example-post")).toBe(25);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      "example-post": 25,
    });
  });

  test("creates a missing persistent directory", async () => {
    const { filePath } = await createStore();
    const nestedFilePath = join(filePath, "..", "persistent", "views.json");
    const nestedStore = new JsonViewStore(nestedFilePath);

    expect(await nestedStore.increment("first-post")).toBe(1);
    expect(JSON.parse(await readFile(nestedFilePath, "utf8"))).toEqual({
      "first-post": 1,
    });
  });
});
