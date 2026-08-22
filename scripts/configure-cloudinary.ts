#!/usr/bin/env bun
/**
 * Interactive, secret-safe Cloudinary bootstrap for production.
 *
 * Secrets enter through a no-echo terminal prompt, go to Cloudinary only in
 * an HTTPS Authorization header, and go to Railway only over stdin. They are
 * never accepted as command arguments, printed, or written to a file.
 */

import { createInterface } from "node:readline/promises";
import { readHiddenInput } from "../src/shared/hiddenPrompt";
import {
  CloudinaryAdminClient,
  PORTFOLIO_TRANSFORMATIONS,
  applyCloudinaryBootstrap,
  planCloudinaryBootstrap,
  railwayVariableCommand,
  validateBootstrapCredentials,
  type CloudinaryBootstrapCredentials,
  type CloudinaryBootstrapOperation,
} from "../src/shared/cloudinaryBootstrap";
import { UPLOAD_PRESET } from "../src/server/media/config";
import { RAILWAY_PRODUCTION_TARGET } from "../src/shared/railwayTarget";

async function ask(question: string): Promise<string> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

function terminalEcho(enabled: boolean): void {
  const result = Bun.spawnSync(["stty", enabled ? "echo" : "-echo"], {
    stdin: "inherit",
    stdout: "ignore",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      "Could not control terminal echo. Secret entry was refused."
    );
  }
}

async function askSecret(question: string): Promise<string> {
  return readHiddenInput(question, {
    input: process.stdin,
    setEcho: terminalEcho,
    write: (text) => process.stdout.write(text),
  });
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Run this script directly in an interactive terminal. Piped secret input is refused."
    );
  }
  if (!Bun.which("railway")) {
    throw new Error("Railway CLI is required.");
  }
  if (!Bun.which("stty")) {
    throw new Error("stty is required for hidden secret entry.");
  }
}

function operationLabel(operation: CloudinaryBootstrapOperation): string {
  switch (operation.kind) {
    case "create-upload-preset":
      return `create signed upload preset ${operation.name}`;
    case "create-transformation":
      return `create ${operation.transformation.name} (${operation.transformation.definition})`;
    case "update-transformation":
      return `set ${operation.transformation.name} to ${operation.transformation.definition}`;
    case "allow-transformation":
      return `allow ${operation.transformation.name} for Strict Transformations`;
  }
}

async function setRailwayVariable(name: string, value: string): Promise<void> {
  const child = Bun.spawn(railwayVariableCommand(name), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(value);
  child.stdin.end();
  const [, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Railway refused variable ${name}. No secret output was shown.`
    );
  }
}

async function verifyRailwayLogin(): Promise<void> {
  const result = Bun.spawnSync(["railway", "whoami"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) {
    throw new Error("Railway CLI is not authenticated. Run: railway login");
  }
}

async function main(): Promise<void> {
  requireInteractiveTerminal();
  await verifyRailwayLogin();

  console.log("Cloudinary production bootstrap");
  console.log(`Railway environment: ${RAILWAY_PRODUCTION_TARGET.environment}`);
  console.log(`Railway service: ${RAILWAY_PRODUCTION_TARGET.service}`);
  console.log("No value entered below will be printed or written to disk.\n");

  const cloudName = await ask("Cloudinary cloud name: ");
  console.log("Cloud name received.");
  const apiKey = await askSecret(
    "Cloudinary API key (typing hidden; paste, then press Enter): "
  );
  console.log("API key received.");
  const apiSecret = await askSecret(
    "Cloudinary API secret (typing hidden; paste, then press Enter): "
  );
  console.log("API secret received.");

  const credentials: CloudinaryBootstrapCredentials = {
    cloudName,
    apiKey,
    apiSecret,
  };
  const errors = validateBootstrapCredentials(credentials);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  console.log(
    "\nVerifying Cloudinary credentials and existing configuration..."
  );
  const client = new CloudinaryAdminClient(credentials);
  const operations = await planCloudinaryBootstrap(client);

  console.log(`Required signed preset: ${UPLOAD_PRESET}`);
  for (const transformation of PORTFOLIO_TRANSFORMATIONS) {
    console.log(
      `Required transformation: ${transformation.name} = ${transformation.definition}`
    );
  }

  if (operations.length === 0) {
    console.log("Cloudinary configuration already matches.");
  } else {
    console.log("Cloudinary changes:");
    for (const operation of operations) {
      console.log(`- ${operationLabel(operation)}`);
    }
  }

  console.log("Railway changes:");
  console.log(
    "- stage MEDIA_PROVIDER, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY"
  );
  console.log("- stage CLOUDINARY_API_SECRET without displaying it");
  console.log(
    "- skip deployment; current production process remains unchanged"
  );
  console.log(
    "- require you to seal CLOUDINARY_API_SECRET in Railway before deployment"
  );

  const confirmation = await ask(
    '\nType "production" to apply these Cloudinary changes and stage Railway variables: '
  );
  if (confirmation !== "production") {
    throw new Error("Confirmation did not match. Nothing was changed.");
  }

  await applyCloudinaryBootstrap(client, operations);
  console.log("Cloudinary configuration ready.");

  for (const [name, value] of [
    ["MEDIA_PROVIDER", "cloudinary"],
    ["CLOUDINARY_CLOUD_NAME", credentials.cloudName],
    ["CLOUDINARY_API_KEY", credentials.apiKey],
    ["CLOUDINARY_API_SECRET", credentials.apiSecret],
  ] as const) {
    await setRailwayVariable(name, value);
    console.log(`Railway variable ${name}: staged`);
  }

  console.log("\nVariables staged. No deployment was triggered.");
  console.log(
    "Required next step: Railway production > web > Variables > CLOUDINARY_API_SECRET > Seal."
  );
  console.log(
    'After sealing, tell Codex: "Cloudinary configured and secret sealed; continue the production import."'
  );
}

main().catch((cause) => {
  const message =
    cause instanceof Error ? cause.message : "Unknown setup failure.";
  console.error(`[cloudinary-setup] BLOCKED: ${message}`);
  process.exit(1);
});
