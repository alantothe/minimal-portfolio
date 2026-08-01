/**
 * Configuration for owner media uploads.
 *
 * Shaped deliberately like `auth/config.ts`: resolution reports "unconfigured"
 * rather than throwing, because a site with no media provider still serves
 * every public page, while a *partial* configuration is a mistake in every
 * environment. The difference from auth is what happens at startup — missing
 * media configuration is not fatal even in production, since it disables
 * uploading rather than leaving a security boundary in an unknown state.
 *
 * The upload preset and the variant names are constants here, not environment
 * variables. They are part of the contract with the provider account, and the
 * security property that owners cannot type transformation syntax only holds if
 * the set of transformations is closed at build time.
 */

const DEFAULT_MAX_UPLOAD_BYTES = 10_000_000;

/**
 * The signed preset that must exist in the Cloudinary product environment.
 * Signed, never unsigned: an unsigned preset can be invoked by anyone who
 * learns its name.
 */
export const UPLOAD_PRESET = "portfolio_owner_images";

/** Formats accepted end to end. SVG is excluded outright — it is script. */
export const ALLOWED_FORMATS = ["jpg", "png", "webp"] as const;
export type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

/** Upper bounds on provider-reported dimensions, as a sanity check. */
export const MAX_IMAGE_DIMENSION = 12_000;

export interface MediaConfig {
  provider: "cloudinary";
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  maxUploadBytes: number;
}

export type MediaConfigResolution =
  | { status: "configured"; config: MediaConfig }
  | { status: "unconfigured"; missing: string[] }
  | { status: "invalid"; reason: string };

function readVariable(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function isPlaceholder(value: string): boolean {
  return (
    value.includes("<") ||
    value.includes(">") ||
    /^(changeme|placeholder|todo|xxx+|your[-_ ]?\w*)$/i.test(value)
  );
}

function parseMaxUploadBytes(raw: string | null): number | null {
  if (!raw) {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  if (!/^[0-9]+$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveMediaConfig(): MediaConfigResolution {
  const provider = readVariable("MEDIA_PROVIDER");
  const cloudName = readVariable("CLOUDINARY_CLOUD_NAME");
  const apiKey = readVariable("CLOUDINARY_API_KEY");
  const apiSecret = readVariable("CLOUDINARY_API_SECRET");

  const missing: string[] = [];
  if (!cloudName) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!apiKey) missing.push("CLOUDINARY_API_KEY");
  if (!apiSecret) missing.push("CLOUDINARY_API_SECRET");

  if (missing.length === 3 && !provider) {
    return { status: "unconfigured", missing };
  }

  if (missing.length > 0) {
    return {
      status: "invalid",
      reason: `Media uploads are partially configured; missing ${missing.join(", ")}`,
    };
  }

  // Only one provider exists today. Naming it explicitly means adding a second
  // one later is a change to this check rather than a silent reinterpretation
  // of what the Cloudinary variables mean.
  if (provider && provider !== "cloudinary") {
    return {
      status: "invalid",
      reason: `Unknown MEDIA_PROVIDER "${provider}"; only "cloudinary" is supported`,
    };
  }

  for (const [name, value] of [
    ["CLOUDINARY_CLOUD_NAME", cloudName],
    ["CLOUDINARY_API_KEY", apiKey],
    ["CLOUDINARY_API_SECRET", apiSecret],
  ] as const) {
    if (isPlaceholder(value!)) {
      return { status: "invalid", reason: `${name} is a placeholder value` };
    }
  }

  const maxUploadBytes = parseMaxUploadBytes(
    readVariable("MEDIA_MAX_UPLOAD_BYTES")
  );
  if (maxUploadBytes === null) {
    return {
      status: "invalid",
      reason: "MEDIA_MAX_UPLOAD_BYTES must be a positive whole number of bytes",
    };
  }

  return {
    status: "configured",
    config: {
      provider: "cloudinary",
      cloudName: cloudName!,
      apiKey: apiKey!,
      apiSecret: apiSecret!,
      maxUploadBytes,
    },
  };
}

/**
 * Startup gate.
 *
 * Unlike authentication, absent media configuration is tolerated everywhere:
 * it disables uploading, and the public site never needed the credentials. A
 * contradictory configuration is still fatal, because it means someone
 * intended to configure this and got it wrong.
 */
export function validateMediaConfigAtStartup(): void {
  const resolution = resolveMediaConfig();

  if (resolution.status === "invalid") {
    throw new Error(`Media uploads misconfigured: ${resolution.reason}`);
  }
}
