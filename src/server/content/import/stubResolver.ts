/**
 * The media resolver rehearsals run against.
 *
 * Turning `/avatar.webp` into a Media record means uploading it to Cloudinary,
 * and turning the Questurian URL into one means verifying it through the Admin
 * API. Neither is possible without credentials, and #42's acceptance —  two
 * clean rehearsals producing identical reports — has to be reachable before
 * those exist.
 *
 * So this resolver answers with **deterministic** ids derived from the
 * reference itself. That is what makes two rehearsals comparable: a random id
 * would make every report differ and the acceptance check meaningless.
 *
 * It is not a fake that hides a difference. The production resolver returns the
 * same shape, and every planning decision — de-duplication, alt text, failing
 * closed on an unsupported reference — is exercised identically either way.
 * What a rehearsal cannot prove is that Cloudinary agrees the asset exists.
 */

import { uuidV5 } from "../identity";
import type { ImportMediaResolver, ResolvedMedia } from "./plan";

/**
 * A namespace distinct from the content one, so a stubbed media id can never
 * collide with a real content id.
 */
export const STUB_MEDIA_NAMESPACE = "1f2c7d90-3b45-4a6e-9c81-7d5e0a4b2f36";

export function stubMediaResolver(): ImportMediaResolver {
  const seen = new Set<string>();

  const resolve = (reference: string): ResolvedMedia => {
    const shared = seen.has(reference);
    seen.add(reference);

    return {
      mediaAssetId: uuidV5(reference, STUB_MEDIA_NAMESPACE),
      shared,
    };
  };

  return {
    async resolveLocal(reference) {
      return resolve(reference);
    },
    async resolveCloudinary(url) {
      return resolve(url);
    },
  };
}

/**
 * A resolver that fails, for testing that the plan refuses rather than writing
 * content pointing at images it could not resolve.
 */
export function failingMediaResolver(): ImportMediaResolver {
  return {
    async resolveLocal() {
      return null;
    },
    async resolveCloudinary() {
      return null;
    },
  };
}
