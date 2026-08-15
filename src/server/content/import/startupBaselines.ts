/** One-time upgrade path for imports edited before Published revisions existed. */

import type { Database } from "bun:sqlite";
import { MediaRepository } from "../../database/mediaRepository";
import { PublicationRepository } from "../../database/publicationRepository";
import { CloudinaryProvider } from "../../media/cloudinary";
import { resolveLegacyCloudName, resolveMediaConfig } from "../../media/config";
import { readLegacyConfig } from "./legacyConfig";
import { importMediaResolver } from "./mediaResolver";
import { planImport } from "./plan";
import { reconcileImportedBaselinesFromPlan } from "./reconcileBaselines";
import { readLegacySources } from "./sources";

export async function reconcileStartupImportBaselines(
  database: Database
): Promise<void> {
  const publication = new PublicationRepository(database);
  if (publication.missingImportedBaselineIds().length === 0) return;

  try {
    await reconcile(database);
  } catch (cause) {
    console.error(
      `[publication] baseline recovery failed: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

async function reconcile(database: Database): Promise<void> {
  const media = resolveMediaConfig();
  if (media.status !== "configured") {
    console.error(
      "[publication] baseline recovery blocked: Media provider is not configured"
    );
    return;
  }

  const plan = await planImport(
    readLegacySources(),
    readLegacyConfig(),
    importMediaResolver({
      config: media.config,
      repository: new MediaRepository(database),
      provider: new CloudinaryProvider(media.config),
      legacyCloudName: resolveLegacyCloudName(),
    })
  );
  const outcome = reconcileImportedBaselinesFromPlan(database, plan);
  if (outcome.status === "seeded") {
    console.log(
      `[publication] recovered ${outcome.count} accepted import baseline(s)`
    );
  } else if (outcome.status === "blocked") {
    console.error(`[publication] baseline recovery blocked: ${outcome.reason}`);
  }
}
