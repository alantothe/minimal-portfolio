/**
 * The owner media routes.
 *
 * Thin by design: authentication and CSRF are the boundary's job, and the
 * upload rules are `media/upload.ts`'s. What is left here is assembling
 * collaborators and turning "not configured" into an honest answer instead of
 * a crash.
 */

import type { RouteContext } from "../core/router";
import { resolveMediaConfig } from "../media/config";
import { CloudinaryProvider } from "../media/cloudinary";
import { handleMediaUpload, type UploadDependencies } from "../media/upload";
import { MediaRepository } from "../database/mediaRepository";
import { getDatabase, isDatabaseAvailable } from "../database";
import { getRecoveryCoordinator } from "../recovery/runtime";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Resolution =
  | { ready: true; dependencies: UploadDependencies }
  | { ready: false; response: Response };

function mediaDependencies(): Resolution {
  const resolution = resolveMediaConfig();

  if (resolution.status !== "configured") {
    return {
      ready: false,
      response: json(503, { error: "media_not_configured" }),
    };
  }

  if (!isDatabaseAvailable()) {
    return {
      ready: false,
      response: json(503, { error: "media_storage_unavailable" }),
    };
  }

  try {
    const recovery = getRecoveryCoordinator();
    return {
      ready: true,
      dependencies: {
        config: resolution.config,
        repository: new MediaRepository(getDatabase()),
        provider: new CloudinaryProvider(resolution.config),
        protectOriginal: recovery
          ? async (input) => {
              await recovery.protectMediaOriginal(input);
            }
          : undefined,
      },
    };
  } catch {
    return {
      ready: false,
      response: json(503, { error: "media_storage_unavailable" }),
    };
  }
}

export async function mediaUploadHandler({
  request,
}: RouteContext): Promise<Response> {
  const resolved = mediaDependencies();
  if (!resolved.ready) {
    return resolved.response;
  }

  return handleMediaUpload(request, resolved.dependencies);
}

/**
 * The picker's list. Ready assets only — an `uploading`, `failed`, or
 * tombstoned asset has no business being offered for placement.
 */
export async function mediaListHandler(): Promise<Response> {
  const resolved = mediaDependencies();
  if (!resolved.ready) {
    return resolved.response;
  }

  const assets = resolved.dependencies.repository.listReady();

  return json(200, {
    assets: assets.map((asset) => ({
      id: asset.id,
      format: asset.format,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      originalFilename: asset.originalFilename,
      altText: asset.altText,
      createdAt: asset.createdAt,
    })),
  });
}
