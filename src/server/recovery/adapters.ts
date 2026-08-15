import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  RecoveryCipher,
  RecoveryObject,
  RecoveryObjectStore,
} from "./recovery";

async function execute(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command[0]} failed (${exitCode}): ${stderr.trim() || "no error detail"}`
    );
  }
}

export class AgeCipher implements RecoveryCipher {
  constructor(private readonly executable = "age") {}

  async encrypt(
    input: string,
    output: string,
    recipients: string[]
  ): Promise<void> {
    const argumentsList = [this.executable, "--encrypt", "--output", output];
    for (const recipient of recipients) {
      argumentsList.push("--recipient", recipient);
    }
    argumentsList.push(input);
    await execute(argumentsList);
  }

  async decrypt(
    input: string,
    output: string,
    identityFile: string
  ): Promise<void> {
    await execute([
      this.executable,
      "--decrypt",
      "--output",
      output,
      "--identity",
      identityFile,
      input,
    ]);
  }
}

function objectPath(root: string, key: string): string {
  if (
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("invalid recovery object key");
  }
  return join(root, ...key.split("/"));
}

/** Filesystem adapter used only by isolated fixture drills. */
export class DirectoryObjectStore implements RecoveryObjectStore {
  constructor(private readonly root: string) {}

  async put(object: RecoveryObject): Promise<void> {
    const file = objectPath(this.root, object.key);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await open(file, "wx", 0o600);
      await handle.writeFile(object.body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`recovery object already exists: ${object.key}`);
      }
      throw error;
    } finally {
      await handle?.close();
    }
    await writeFile(`${file}.metadata.json`, JSON.stringify(object.metadata), {
      flag: "wx",
      mode: 0o600,
    });
  }

  async head(key: string): Promise<Omit<RecoveryObject, "body"> | null> {
    const file = objectPath(this.root, key);
    try {
      const [details, metadata] = await Promise.all([
        stat(file),
        readFile(`${file}.metadata.json`, "utf8"),
      ]);
      return {
        key,
        bytes: details.size,
        metadata: JSON.parse(metadata) as Record<string, string>,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async get(key: string): Promise<RecoveryObject | null> {
    const file = objectPath(this.root, key);
    try {
      const [body, metadata] = await Promise.all([
        readFile(file),
        readFile(`${file}.metadata.json`, "utf8"),
      ]);
      return {
        key,
        body: new Uint8Array(body),
        metadata: JSON.parse(metadata) as Record<string, string>,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = objectPath(this.root, prefix.replace(/\/$/, "/placeholder"));
    const directory = dirname(base);
    const files = new Bun.Glob("**/*.age");
    try {
      const keys: string[] = [];
      for await (const relative of files.scan({
        cwd: directory,
        onlyFiles: true,
      })) {
        keys.push(`${prefix}${relative}`);
      }
      return keys.sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

export interface RecoveryS3Client {
  send(command: unknown): Promise<unknown>;
}

interface R2StoreConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function missingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export class R2ObjectStore implements RecoveryObjectStore {
  private readonly client: RecoveryS3Client;

  constructor(
    private readonly config: R2StoreConfig,
    client?: RecoveryS3Client
  ) {
    if (client) {
      this.client = client;
      return;
    }
    const s3 = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.client = {
      send: (command) => s3.send(command as never),
    };
  }

  async put(object: RecoveryObject): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: object.key,
        Body: object.body,
        ContentType: "application/octet-stream",
        IfNoneMatch: "*",
        Metadata: object.metadata,
      })
    );
  }

  async head(key: string): Promise<Omit<RecoveryObject, "body"> | null> {
    try {
      const result = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })
      )) as { ContentLength?: number; Metadata?: Record<string, string> };
      return {
        key,
        bytes: result.ContentLength,
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      if (missingObject(error)) return null;
      throw error;
    }
  }

  async get(key: string): Promise<RecoveryObject | null> {
    try {
      const result = (await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key })
      )) as {
        Metadata?: Record<string, string>;
        Body?: { transformToByteArray(): Promise<Uint8Array> };
      };
      if (!result.Body) throw new Error("R2 object response has no body");
      return {
        key,
        body: await result.Body.transformToByteArray(),
        metadata: result.Metadata ?? {},
      };
    } catch (error) {
      if (missingObject(error)) return null;
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const result = (await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      )) as {
        Contents?: Array<{ Key?: string }>;
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };
      for (const object of result.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = result.IsTruncated
        ? result.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys.sort();
  }
}
