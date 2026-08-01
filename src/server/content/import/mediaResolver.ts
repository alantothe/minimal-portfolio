/**
 * The media resolver the real import runs against.
 *
 * `stubResolver.ts` answers with derived ids so a rehearsal can exercise every
 * planning decision without credentials. This is its counterpart: same port,
 * same shape of answer, but every id it returns names an image that is actually
 * stored, verified, and renderable.
 *
 * Three kinds of reference exist in the legacy content and each gets a
 * different treatment, for reasons that are about evidence rather than
 * mechanism:
 *
 *   **Local files** (`/avatar.webp`, `/public/logo.png`, `/public/og.png`) are
 *   read through the same path mapping `StaticHandler` serves them with, so the
 *   bytes uploaded are provably the bytes a visitor receives today.
 *
 *   **Cloudinary URLs on the configured cloud** go through
 *   `importLegacyCloudinaryImage`, which asks the Admin API and records only
 *   what the provider answered. Nothing is uploaded; the asset is already
 *   there, and the provider is the authority on what it is.
 *
 *   **Cloudinary URLs on the legacy cloud** cannot be verified that way — the
 *   credentials cannot reach `dz18m79a1` at all. They are fetched from the
 *   public delivery URL and re-uploaded to the configured cloud, with identity
 *   proven by hashing the content instead of by asking an account we do not
 *   control. This is the only path that moves bytes between clouds, and it is
 *   deliberately narrow: exactly one cloud name is accepted, and it has to be
 *   named in configuration.
 *
 * Anything else fails closed. The port returns `null`, the planner records
 * `media_unresolved`, and the import refuses rather than writing content that
 * points at an image nobody has.
 */

import { basename } from "node:path";
import { resolveLocalAssetPath } from "../../core/staticPath";
import { adoptImageBytes } from "../../media/adopt";
import { fetchDeliveredImage } from "../../media/fetchImage";
import { parseCloudinaryDeliveryUrl } from "../../media/legacy";
import { importLegacyCloudinaryImage } from "../../media/legacyImport";
import type { MediaConfig } from "../../media/config";
import type { MediaProvider } from "../../media/cloudinary";
import type { MediaRepository } from "../../database/mediaRepository";
import type { ImportMediaResolver, ResolvedMedia } from "./plan";

/**
 * Why a reference resolved the way it did.
 *
 * The port answers `ResolvedMedia | null` because that is all the planner needs
 * — a null becomes `media_unresolved` in the findings. That is the right
 * interface and the wrong amount of information for a person running the
 * import at three in the morning, so reasons come out through this channel
 * instead of being smuggled into the return type.
 */
export interface ResolverDiagnostic {
  reference: string;
  kind: "local" | "cloudinary";
  outcome: string;
}

export interface ImportMediaResolverDependencies {
  config: MediaConfig;
  repository: MediaRepository;
  provider: MediaProvider;
  /** The cloud holding pre-migration assets, from `resolveLegacyCloudName()`. */
  legacyCloudName: string;
  /** Injected so tests exercise the policy without a network. */
  fetchImage?: typeof fetchDeliveredImage;
  readFile?: (path: string) => Promise<Uint8Array | null>;
  onDiagnostic?: (diagnostic: ResolverDiagnostic) => void;
}

async function readFromDisk(path: string): Promise<Uint8Array | null> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return null;
  }

  return new Uint8Array(await file.arrayBuffer());
}

export function importMediaResolver(
  dependencies: ImportMediaResolverDependencies
): ImportMediaResolver {
  const {
    config,
    repository,
    provider,
    legacyCloudName,
    fetchImage = fetchDeliveredImage,
    readFile = readFromDisk,
    onDiagnostic,
  } = dependencies;

  const adoptDependencies = { config, repository, provider };

  function report(
    reference: string,
    kind: ResolverDiagnostic["kind"],
    outcome: string
  ): null {
    onDiagnostic?.({ reference, kind, outcome });
    return null;
  }

  /** Both byte-carrying paths end here, so they cannot diverge. */
  async function adopt(
    reference: string,
    kind: ResolverDiagnostic["kind"],
    bytes: Uint8Array,
    originalFilename: string | null
  ): Promise<ResolvedMedia | null> {
    const outcome = await adoptImageBytes(bytes, adoptDependencies, {
      originalFilename,
    });

    if (outcome.status === "adopted" || outcome.status === "already_adopted") {
      onDiagnostic?.({ reference, kind, outcome: outcome.status });
      return {
        mediaAssetId: outcome.asset.id,
        shared: outcome.status === "already_adopted",
      };
    }

    return report(reference, kind, `${outcome.status}:${outcome.reason}`);
  }

  return {
    async resolveLocal(reference) {
      const path = resolveLocalAssetPath(reference);

      if (path.status === "rejected") {
        return report(reference, "local", `rejected:${path.reason}`);
      }

      const bytes = await readFile(path.path);

      if (bytes === null) {
        return report(reference, "local", "rejected:local_file_not_found");
      }

      return adopt(reference, "local", bytes, basename(path.path));
    },

    async resolveCloudinary(url) {
      const parsed = parseCloudinaryDeliveryUrl(url);

      if (parsed.kind !== "cloudinary") {
        return report(url, "cloudinary", "rejected:not_a_cloudinary_url");
      }

      if (parsed.cloudName === config.cloudName) {
        // Already in the account this application controls. The provider can
        // vouch for it, so nothing needs to move.
        const outcome = await importLegacyCloudinaryImage(url, {
          repository,
          provider,
          cloudName: config.cloudName,
        });

        if (
          outcome.status === "imported" ||
          outcome.status === "already_imported"
        ) {
          onDiagnostic?.({
            reference: url,
            kind: "cloudinary",
            outcome: outcome.status,
          });
          return {
            mediaAssetId: outcome.asset.id,
            shared: outcome.status === "already_imported",
          };
        }

        return report(url, "cloudinary", `${outcome.status}:${outcome.reason}`);
      }

      if (parsed.cloudName !== legacyCloudName) {
        // Not our account and not the one cloud we have agreed to adopt from.
        // Fetching it would mean this application decides, at import time,
        // which arbitrary host to pull bytes from.
        return report(url, "cloudinary", "rejected:unknown_cloud");
      }

      const fetched = await fetchImage(url, {
        maxBytes: config.maxUploadBytes,
      });

      if (fetched.status !== "ok") {
        return report(url, "cloudinary", `${fetched.status}:${fetched.reason}`);
      }

      // The public ID's last segment is the closest thing to a filename this
      // asset has, and it is the only surviving record of where it came from
      // once the Markdown stops being authoritative.
      const originalFilename = parsed.publicId.split("/").pop() ?? null;

      return adopt(url, "cloudinary", fetched.bytes, originalFilename);
    },
  };
}
