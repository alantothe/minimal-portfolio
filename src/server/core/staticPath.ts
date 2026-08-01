/**
 * Where a request path lands on disk.
 *
 * This rule used to live as a private method on `StaticHandler`, which was fine
 * while serving was the only thing that needed it. The importer now needs it
 * too: it has to upload the bytes a visitor actually receives from
 * `/avatar.webp`, and the only way to make that claim structurally true rather
 * than coincidentally true is for both callers to ask the same function.
 *
 * A second copy of the mapping would be worse than no copy. The two would agree
 * on the day it was written and then drift, and the failure mode of drift is an
 * import that silently adopts a *different* file from the one being served —
 * which is exactly the kind of thing the golden contract cannot catch, because
 * both files exist and both requests succeed.
 */

import { serverConfig } from "./config";

/**
 * The repository path a request pathname resolves to, as a server-absolute
 * string (`/src/public/og.png`).
 *
 * Byte-identical to the mapping `StaticHandler` has always applied, including
 * the doubled separator the fallback branch produces for a bare `/avatar.webp`.
 * `Bun.file` treats `./src/public//avatar.webp` and `./src/public/avatar.webp`
 * identically, and preserving the exact string keeps this a pure extraction.
 */
export function resolveStaticFilePath(pathname: string): string {
  if (pathname.startsWith(serverConfig.static.publicPath)) {
    return `/src${pathname}`;
  }

  if (pathname.startsWith(serverConfig.static.pagesPath)) {
    return `/src${pathname}`;
  }

  if (pathname.startsWith(serverConfig.static.layoutPath)) {
    return `/src${pathname}`;
  }

  // Default to the public directory.
  return `/src${serverConfig.static.publicPath}${pathname}`;
}

/** Everything the importer is willing to read from. */
const IMPORTABLE_ROOT = "src/public/";

export type LocalAssetPath =
  { status: "ok"; path: string } | { status: "rejected"; reason: string };

/**
 * The same mapping, narrowed to what the importer may read.
 *
 * Serving and importing need different guards, which is why this is a separate
 * entry point rather than a flag. The server receives its pathname from
 * `new URL()`, which has already collapsed `..` before anything sees it. The
 * importer receives raw strings out of `src/config/index.ts` and Project
 * frontmatter, where no such normalisation has happened, so traversal has to be
 * refused here.
 *
 * Restricting to `src/public/` is not only about traversal. `StaticHandler`
 * also serves `/pages/` and `/layout/`, which hold templates rather than
 * assets; an import that uploaded one of those to a CDN would be a mistake
 * whether or not the path was well-formed.
 */
export function resolveLocalAssetPath(reference: string): LocalAssetPath {
  if (!reference.startsWith("/") || reference.startsWith("//")) {
    // `//host/path` is protocol-relative — a remote reference wearing a local
    // reference's clothes.
    return { status: "rejected", reason: "not_a_local_reference" };
  }

  if (reference.includes("\0")) {
    return { status: "rejected", reason: "invalid_local_reference" };
  }

  // Query strings and fragments are meaningful to a browser and meaningless to
  // a filesystem. Refusing beats guessing which part is the filename.
  if (reference.includes("?") || reference.includes("#")) {
    return { status: "rejected", reason: "invalid_local_reference" };
  }

  const resolved = resolveStaticFilePath(reference).replace(/^\//, "");

  // Collapse `.`, `..`, and repeated separators, then check containment on the
  // result. Checking the input for `..` instead would be a blocklist, and
  // blocklists on paths are a well-trodden way to be wrong.
  const segments: string[] = [];
  for (const segment of resolved.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const path = segments.join("/");

  if (!path.startsWith(IMPORTABLE_ROOT) || path === IMPORTABLE_ROOT) {
    return { status: "rejected", reason: "outside_public_directory" };
  }

  return { status: "ok", path };
}
