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

/**
 * The content type sent to the provider for each detected format.
 *
 * Keyed by the format the *magic bytes* reported, never by what a filename or a
 * client-supplied header claimed, so the value here always describes the bytes
 * being sent.
 */
export const CONTENT_TYPE_FOR_FORMAT: Record<AllowedFormat, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The single hostname images may be delivered from.
 *
 * Cloudinary serves every account from this host and distinguishes them by the
 * first path segment, so this constant is what the CSP can pin and the cloud
 * name is not. Narrowing further is the renderer's job, not the browser's.
 */
export const DELIVERY_HOST = "res.cloudinary.com";

/**
 * The cloud that holds assets uploaded before this migration.
 *
 * It was hard-coded in the Markdown service; naming it here makes it
 * configuration without changing what any existing page renders. The default is
 * the value that was compiled in, so an environment that sets nothing keeps
 * producing byte-identical URLs.
 */
const DEFAULT_LEGACY_CLOUD_NAME = "dz18m79a1";

export function resolveLegacyCloudName(): string {
  return readVariable("MEDIA_LEGACY_CLOUD_NAME") ?? DEFAULT_LEGACY_CLOUD_NAME;
}

/**
 * Every transformation the application is allowed to ask for.
 *
 * This is the security boundary for delivery. Owners choose a variant, never a
 * transformation string, so the set has to be closed at build time — a variant
 * that came from Content or a query string would let anyone generate arbitrary
 * billable derivatives, which is exactly what Cloudinary's Strict
 * Transformations setting exists to prevent.
 *
 * The names must match named transformations defined in the Cloudinary product
 * environment. Format and quality selection (`f_auto`, `q_auto`) belong *inside*
 * those definitions rather than being appended here: under Strict
 * Transformations only the named transformation is permitted, and a URL that
 * combined `t_portfolio_card` with extra parameters would be refused.
 *
 * `fill` crops to an exact box, so the rendered size is known from the variant
 * alone. `limit` never upscales, so the rendered size depends on the asset and
 * is computed from its stored dimensions.
 */
export type VariantSpec =
  | { fit: "fill"; width: number; height: number }
  | { fit: "limit"; maxWidth: number };

export const MEDIA_VARIANTS = {
  portfolio_avatar: { fit: "fill", width: 800, height: 800 },
  portfolio_card: { fit: "fill", width: 600, height: 360 },
  portfolio_wide: { fit: "limit", maxWidth: 1600 },
} as const satisfies Record<string, VariantSpec>;

export type MediaVariant = keyof typeof MEDIA_VARIANTS;

/**
 * The guard that keeps the enum closed at runtime.
 *
 * The type alone is not enough: variants will arrive from the database and from
 * Owner form submissions, both of which are `string` as far as the compiler is
 * concerned.
 *
 * `Object.hasOwn` rather than `in`, because `in` walks the prototype chain and
 * would accept `"toString"` and `"constructor"` as variant names.
 */
export function isMediaVariant(value: unknown): value is MediaVariant {
  return typeof value === "string" && Object.hasOwn(MEDIA_VARIANTS, value);
}

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
