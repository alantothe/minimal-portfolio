import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgeCipher,
  DirectoryObjectStore,
  R2ObjectStore,
  type RecoveryS3Client,
} from "./adapters";

const directories: string[] = [];

afterEach(async () => {
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

test("AgeCipher passes recipients and identity as argv, never shell text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "age-adapter-"));
  directories.push(directory);
  const executable = join(directory, "fake-age");
  const input = join(directory, "input file");
  const encrypted = join(directory, "encrypted file");
  const decrypted = join(directory, "decrypted file");
  const argumentsFile = join(directory, "arguments");
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argumentsFile}"\ninput=''\noutput=''\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    --output) output="$2"; shift 2 ;;\n    --recipient|--identity) shift 2 ;;\n    --encrypt|--decrypt) shift ;;\n    *) input="$1"; shift ;;\n  esac\ndone\ncp "$input" "$output"\n`
  );
  await chmod(executable, 0o700);
  await writeFile(input, "portable bytes");
  const cipher = new AgeCipher(executable);

  await cipher.encrypt(input, encrypted, ["age1owner", "age1drill"]);
  await cipher.decrypt(encrypted, decrypted, "identity file");

  expect(await readFile(decrypted, "utf8")).toBe("portable bytes");
  expect((await readFile(argumentsFile, "utf8")).split("\n")).toEqual([
    "--encrypt",
    "--output",
    encrypted,
    "--recipient",
    "age1owner",
    "--recipient",
    "age1drill",
    input,
    "--decrypt",
    "--output",
    decrypted,
    "--identity",
    "identity file",
    encrypted,
    "",
  ]);
});

describe("DirectoryObjectStore", () => {
  test("round-trips body and verification metadata without overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "recovery-store-"));
    directories.push(directory);
    const store = new DirectoryObjectStore(directory);
    const object = {
      key: "db/hourly/2026/08/14/example.tar.age",
      body: new TextEncoder().encode("encrypted"),
      metadata: { sha256: "digest" },
    };

    await store.put(object);

    expect(await store.head(object.key)).toEqual({
      key: object.key,
      bytes: 9,
      metadata: object.metadata,
    });
    expect(await store.get(object.key)).toEqual(object);
    await expect(store.put(object)).rejects.toThrow("already exists");
  });

  test("refuses object keys that escape store root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "recovery-store-"));
    directories.push(directory);
    const store = new DirectoryObjectStore(directory);

    await expect(
      store.put({
        key: "../outside",
        body: new Uint8Array([1]),
        metadata: {},
      })
    ).rejects.toThrow("invalid recovery object key");
  });
});

test("R2ObjectStore uses conditional PUT then HEAD/GET verification data", async () => {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const body = new Uint8Array([1, 2, 3]);
  const client: RecoveryS3Client = {
    async send(command) {
      const captured = command as {
        constructor: { name: string };
        input: Record<string, unknown>;
      };
      sent.push({ name: captured.constructor.name, input: captured.input });
      if (captured.constructor.name === "HeadObjectCommand") {
        return { ContentLength: 3, Metadata: { sha256: "digest" } };
      }
      if (captured.constructor.name === "GetObjectCommand") {
        return {
          Metadata: { sha256: "digest" },
          Body: { transformToByteArray: async () => body },
        };
      }
      return {};
    },
  };
  const store = new R2ObjectStore(
    {
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "recovery",
      accessKeyId: "access",
      secretAccessKey: "secret",
    },
    client
  );
  const object = {
    key: "db/hourly/example.tar.age",
    body,
    metadata: { sha256: "digest" },
  };

  await store.put(object);

  expect(await store.head(object.key)).toEqual({
    key: object.key,
    bytes: 3,
    metadata: object.metadata,
  });
  expect(await store.get(object.key)).toEqual(object);
  expect(sent[0]).toEqual({
    name: "PutObjectCommand",
    input: {
      Bucket: "recovery",
      Key: object.key,
      Body: body,
      ContentType: "application/octet-stream",
      IfNoneMatch: "*",
      Metadata: object.metadata,
    },
  });
});
