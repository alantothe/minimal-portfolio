import {
  MEDIA_VARIANTS,
  UPLOAD_PRESET,
  type VariantSpec,
} from "../server/media/config";

export interface CloudinaryBootstrapCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface PortfolioTransformation {
  name: keyof typeof MEDIA_VARIANTS;
  definition: string;
  info: Array<Record<string, string | number>>;
}

export type CloudinaryBootstrapOperation =
  | { kind: "create-upload-preset"; name: string }
  | { kind: "create-transformation"; transformation: PortfolioTransformation }
  | { kind: "update-transformation"; transformation: PortfolioTransformation }
  | { kind: "allow-transformation"; transformation: PortfolioTransformation };

interface UploadPresetDetails {
  name?: unknown;
  unsigned?: unknown;
  settings?: { disallow_public_id?: unknown };
  disallow_public_id?: unknown;
}

interface TransformationDetails {
  name?: unknown;
  named?: unknown;
  allowed_for_strict?: unknown;
  info?: unknown;
  derived?: unknown;
  next_cursor?: unknown;
}

type Lookup<T> = { status: "found"; value: T } | { status: "missing" };

export type HttpRequest = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const RAILWAY_PRODUCTION_TARGET = {
  project: "7575053c-953e-4de2-ab38-b4b88f043086",
  environment: "production",
  service: "9c4d4559-a930-44ee-b152-afcc40d2a36c",
} as const;

function transformationDefinition(spec: VariantSpec): string {
  return spec.fit === "fill"
    ? `c_fill,h_${spec.height},w_${spec.width}/q_auto`
    : `c_limit,w_${spec.maxWidth}/q_auto`;
}

function transformationInfo(
  spec: VariantSpec
): Array<Record<string, string | number>> {
  return spec.fit === "fill"
    ? [
        { crop: "fill", height: spec.height, width: spec.width },
        { quality: "auto" },
      ]
    : [{ crop: "limit", width: spec.maxWidth }, { quality: "auto" }];
}

export const PORTFOLIO_TRANSFORMATIONS: PortfolioTransformation[] =
  Object.entries(MEDIA_VARIANTS).map(([name, spec]) => ({
    name: name as keyof typeof MEDIA_VARIANTS,
    definition: transformationDefinition(spec),
    info: transformationInfo(spec),
  }));

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function validateBootstrapCredentials(
  credentials: CloudinaryBootstrapCredentials
): string[] {
  const errors: string[] = [];

  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(credentials.cloudName)) {
    errors.push(
      "Cloud name may contain only letters, numbers, underscores, and hyphens."
    );
  }

  for (const [label, value] of [
    ["API key", credentials.apiKey],
    ["API secret", credentials.apiSecret],
  ] as const) {
    if (!value || value.length > 512 || hasControlCharacter(value)) {
      errors.push(
        `${label} is empty, too long, or contains a control character.`
      );
    }
  }

  return errors;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left !== "object" || typeof right !== "object") {
    return left === right;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }

  const leftEntries = Object.entries(left as Record<string, unknown>).sort();
  const rightEntries = Object.entries(right as Record<string, unknown>).sort();
  return sameValue(leftEntries, rightEntries);
}

function expectedTransformationInfo(
  details: TransformationDetails,
  transformation: PortfolioTransformation
): boolean {
  return sameValue(details.info, transformation.info);
}

export class CloudinaryAdminClient {
  private readonly authorization: string;

  constructor(
    private readonly credentials: CloudinaryBootstrapCredentials,
    private readonly request: HttpRequest = fetch
  ) {
    this.authorization = `Basic ${Buffer.from(
      `${credentials.apiKey}:${credentials.apiSecret}`
    ).toString("base64")}`;
  }

  private endpoint(path: string): string {
    return `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      this.credentials.cloudName
    )}/${path}`;
  }

  private async call(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: URLSearchParams
  ): Promise<Response> {
    try {
      return await this.request(this.endpoint(path), {
        method,
        headers: {
          Authorization: this.authorization,
          ...(body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Cloudinary could not be reached.");
    }
  }

  private async json<T>(response: Response, action: string): Promise<T> {
    if (!response.ok) {
      throw new Error(
        `Cloudinary refused ${action} (HTTP ${response.status}).`
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(`Cloudinary returned an invalid response for ${action}.`);
    }
  }

  async verifyCredentials(): Promise<void> {
    const response = await this.call("GET", "ping");
    await this.json(response, "credential verification");
  }

  async findUploadPreset(name: string): Promise<Lookup<UploadPresetDetails>> {
    const response = await this.call(
      "GET",
      `upload_presets/${encodeURIComponent(name)}`
    );
    if (response.status === 404) return { status: "missing" };
    return {
      status: "found",
      value: await this.json(response, "upload preset inspection"),
    };
  }

  async createUploadPreset(name: string): Promise<void> {
    const body = new URLSearchParams({
      name,
      unsigned: "false",
      disallow_public_id: "false",
    });
    const response = await this.call("POST", "upload_presets", body);
    await this.json(response, "upload preset creation");
  }

  async findTransformation(
    name: string
  ): Promise<Lookup<TransformationDetails>> {
    const response = await this.call(
      "GET",
      `transformations/${encodeURIComponent(`t_${name}`)}?max_results=1`
    );
    if (response.status === 404) return { status: "missing" };
    return {
      status: "found",
      value: await this.json(response, "transformation inspection"),
    };
  }

  async createTransformation(
    transformation: PortfolioTransformation
  ): Promise<void> {
    const body = new URLSearchParams({
      transformation: transformation.definition,
      allowed_for_strict: "true",
    });
    const response = await this.call(
      "POST",
      `transformations/${encodeURIComponent(transformation.name)}`,
      body
    );
    await this.json(response, "transformation creation");
  }

  async allowTransformation(name: string): Promise<void> {
    const response = await this.call(
      "PUT",
      `transformations/${encodeURIComponent(`t_${name}`)}`,
      new URLSearchParams({ allowed_for_strict: "true" })
    );
    await this.json(response, "Strict Transformations update");
  }

  async updateTransformation(
    transformation: PortfolioTransformation
  ): Promise<void> {
    const response = await this.call(
      "PUT",
      `transformations/${encodeURIComponent(`t_${transformation.name}`)}`,
      new URLSearchParams({
        unsafe_update: transformation.definition,
        allowed_for_strict: "true",
      })
    );
    await this.json(response, "unused transformation update");
  }
}

function isProvenUnusedTransformation(details: TransformationDetails): boolean {
  return (
    Array.isArray(details.derived) &&
    details.derived.length === 0 &&
    details.next_cursor === undefined
  );
}

export async function planCloudinaryBootstrap(
  client: CloudinaryAdminClient
): Promise<CloudinaryBootstrapOperation[]> {
  await client.verifyCredentials();
  const operations: CloudinaryBootstrapOperation[] = [];
  const preset = await client.findUploadPreset(UPLOAD_PRESET);

  if (preset.status === "missing") {
    operations.push({ kind: "create-upload-preset", name: UPLOAD_PRESET });
  } else {
    const disallowPublicId =
      preset.value.disallow_public_id ??
      preset.value.settings?.disallow_public_id ??
      false;
    if (
      preset.value.name !== UPLOAD_PRESET ||
      preset.value.unsigned !== false ||
      disallowPublicId !== false
    ) {
      throw new Error(
        `Existing upload preset "${UPLOAD_PRESET}" is not the required signed preset. Refusing to overwrite it.`
      );
    }
  }

  for (const transformation of PORTFOLIO_TRANSFORMATIONS) {
    const existing = await client.findTransformation(transformation.name);
    if (existing.status === "missing") {
      operations.push({ kind: "create-transformation", transformation });
      continue;
    }

    if (
      existing.value.name !== `t_${transformation.name}` ||
      existing.value.named !== true ||
      !expectedTransformationInfo(existing.value, transformation)
    ) {
      if (isProvenUnusedTransformation(existing.value)) {
        operations.push({ kind: "update-transformation", transformation });
        continue;
      }
      throw new Error(
        `Existing transformation "${transformation.name}" has a different definition and is used or its usage could not be proven empty. Refusing to overwrite it.`
      );
    }

    if (existing.value.allowed_for_strict !== true) {
      operations.push({ kind: "allow-transformation", transformation });
    }
  }

  return operations;
}

export async function applyCloudinaryBootstrap(
  client: CloudinaryAdminClient,
  operations: CloudinaryBootstrapOperation[]
): Promise<void> {
  for (const operation of operations) {
    switch (operation.kind) {
      case "create-upload-preset":
        await client.createUploadPreset(operation.name);
        break;
      case "create-transformation":
        await client.createTransformation(operation.transformation);
        break;
      case "update-transformation":
        await client.updateTransformation(operation.transformation);
        break;
      case "allow-transformation":
        await client.allowTransformation(operation.transformation.name);
        break;
    }
  }
}

export function railwayVariableCommand(name: string): string[] {
  return [
    "railway",
    "variable",
    "set",
    "--project",
    RAILWAY_PRODUCTION_TARGET.project,
    "--environment",
    RAILWAY_PRODUCTION_TARGET.environment,
    "--service",
    RAILWAY_PRODUCTION_TARGET.service,
    name,
    "--stdin",
    "--skip-deploys",
  ];
}
