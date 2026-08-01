/**
 * Configuration for the Owner sign-in flow.
 *
 * Three ideas hold this module together:
 *
 * 1. **The callback URI is derived, never configured.** GitHub matches the
 *    redirect URI exactly, so a separate `GITHUB_OAUTH_CALLBACK_URL` variable
 *    would be a second copy of a value that must equal the OAuth App's
 *    registration. Two copies drift. Deriving it from the already-validated
 *    `SITE_URL` means a wrong origin fails loudly at startup rather than
 *    producing a `redirect_uri_mismatch` in a browser nobody is watching.
 *
 * 2. **Missing configuration is not the same as broken configuration.** Tests
 *    and a fresh clone have no OAuth App, and the public site does not need one.
 *    So resolution reports "unconfigured" rather than throwing, and only
 *    production startup treats that as fatal. What is never allowed is a
 *    half-configured state: a client ID with no secret is a bug in every
 *    environment.
 *
 * 3. **The owner ID is configuration, not a secret.** It is compared against
 *    GitHub's immutable numeric `id`. Logins can be renamed and re-registered;
 *    the number cannot.
 */

const CALLBACK_PATH = "/admin/auth/github/callback";

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  ownerId: number;
  /** The trusted origin, also the only acceptable `Origin` on a mutation. */
  origin: string;
  /** Exactly what the OAuth App must have registered. */
  callbackUrl: string;
}

export type AuthConfigResolution =
  | { status: "configured"; config: AuthConfig }
  | { status: "unconfigured"; missing: string[] }
  | { status: "invalid"; reason: string };

/**
 * A value that is present but obviously a stand-in. Catching these matters
 * because a placeholder secret fails at the token exchange — the last step of a
 * browser round-trip — instead of at boot where it is diagnosable.
 */
function isPlaceholder(value: string): boolean {
  return (
    value.includes("<") ||
    value.includes(">") ||
    /^(changeme|placeholder|todo|xxx+|your[-_ ]?\w*)$/i.test(value)
  );
}

function readVariable(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

/**
 * The origin the site is served from, or null when `SITE_URL` is unusable.
 *
 * Deliberately re-parsed here rather than imported from `seo.ts`: that module
 * falls back to the request's own origin for canonical URLs, which is fine for
 * a `<link rel=canonical>` and completely wrong for deciding whether a request
 * is same-origin. A forged `Host` header must never be able to widen the set of
 * origins that may mutate content.
 */
function resolveTrustedOrigin(): { origin: string } | { error: string } {
  const configured = readVariable("SITE_URL");
  if (!configured) {
    return { error: "SITE_URL is not set" };
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return { error: "SITE_URL must be an absolute HTTP(S) URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "SITE_URL must be an absolute HTTP(S) URL" };
  }

  // `__Host-` cookies require `Secure`, and browsers grant http://localhost the
  // secure-context exemption. That keeps local development on exactly the same
  // cookie attributes as production instead of a weakened dev-only variant that
  // would leave the real attributes untested until deploy.
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";

  if (parsed.protocol === "http:" && !isLoopback) {
    return {
      error: "SITE_URL must use HTTPS unless it is a loopback address",
    };
  }

  return { origin: parsed.origin };
}

function parseOwnerId(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveAuthConfig(): AuthConfigResolution {
  const clientId = readVariable("GITHUB_OAUTH_CLIENT_ID");
  const clientSecret = readVariable("GITHUB_OAUTH_CLIENT_SECRET");
  const ownerIdRaw = readVariable("GITHUB_OWNER_ID");

  const missing: string[] = [];
  if (!clientId) missing.push("GITHUB_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GITHUB_OAUTH_CLIENT_SECRET");
  if (!ownerIdRaw) missing.push("GITHUB_OWNER_ID");

  // All three absent is a site that simply has no Owner workspace configured.
  // Some-but-not-all is always a mistake, so it is reported as invalid rather
  // than quietly disabling sign-in.
  if (missing.length === 3) {
    return { status: "unconfigured", missing };
  }

  if (missing.length > 0) {
    return {
      status: "invalid",
      reason: `Owner authentication is partially configured; missing ${missing.join(", ")}`,
    };
  }

  for (const [name, value] of [
    ["GITHUB_OAUTH_CLIENT_ID", clientId],
    ["GITHUB_OAUTH_CLIENT_SECRET", clientSecret],
  ] as const) {
    if (isPlaceholder(value!)) {
      return { status: "invalid", reason: `${name} is a placeholder value` };
    }
  }

  const ownerId = parseOwnerId(ownerIdRaw!);
  if (ownerId === null) {
    return {
      status: "invalid",
      reason: "GITHUB_OWNER_ID must be a positive whole number",
    };
  }

  const origin = resolveTrustedOrigin();
  if ("error" in origin) {
    return { status: "invalid", reason: origin.error };
  }

  return {
    status: "configured",
    config: {
      clientId: clientId!,
      clientSecret: clientSecret!,
      ownerId,
      origin: origin.origin,
      callbackUrl: `${origin.origin}${CALLBACK_PATH}`,
    },
  };
}

/**
 * Startup gate.
 *
 * Invalid configuration is fatal everywhere, because it is a mistake rather
 * than a state. Absent configuration is fatal only in production, where an
 * Owner workspace nobody can sign in to is a broken deploy.
 */
export function validateAuthConfigAtStartup(): void {
  const resolution = resolveAuthConfig();

  if (resolution.status === "invalid") {
    throw new Error(`Owner authentication misconfigured: ${resolution.reason}`);
  }

  if (
    resolution.status === "unconfigured" &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      `Owner authentication requires ${resolution.missing.join(", ")} in production`
    );
  }

  if (
    resolution.status === "configured" &&
    process.env.NODE_ENV === "production" &&
    !resolution.config.origin.startsWith("https:")
  ) {
    throw new Error(
      "Owner authentication requires an HTTPS SITE_URL in production"
    );
  }
}

export { CALLBACK_PATH };
