/**
 * Where the content database lives.
 *
 * In production this must be an absolute path on the mounted Railway volume.
 * Railway deployment filesystems are ephemeral, so a relative path would put
 * published content somewhere that silently disappears on the next deploy —
 * the one failure this layer must never have. A misconfigured path is refused
 * outright rather than being quietly accepted.
 */

import { isAbsolute } from "node:path";

export const PRODUCTION_DATABASE_FILE = "/data/content.sqlite";
export const DEVELOPMENT_DATABASE_FILE = "./src/data/content.sqlite";

export function resolveDatabaseFile(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const configured = environment.CONTENT_DATABASE_FILE?.trim();
  const isProduction = environment.NODE_ENV === "production";

  if (!configured) {
    return isProduction ? PRODUCTION_DATABASE_FILE : DEVELOPMENT_DATABASE_FILE;
  }

  if (isProduction && !isAbsolute(configured)) {
    throw new Error(
      `CONTENT_DATABASE_FILE must be an absolute path on the persistent volume in production; received "${configured}"`
    );
  }

  return configured;
}
