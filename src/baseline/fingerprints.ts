/**
 * Content and media identity, independent of how any page renders them.
 *
 * The route snapshots already prove what the site *renders*. These fingerprints
 * prove what it renders *from*, which is what the import in a later slice has
 * to reproduce byte for byte. A Media asset that survives migration with a
 * different digest is a different asset, however similar it looks.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileFingerprint, ViewFingerprint } from "./contract";
import { sha256 } from "./normalize";

/** Sources a Visitor's page is built from. */
const CONTENT_ROOTS = [
  { directory: "src/content", extensions: [".md"] },
  { directory: "src/pages", extensions: [".html"] },
  { directory: "src/config", extensions: [".ts"] },
];

/** Uploadable assets. Everything else in `src/public` is behaviour, not media. */
const MEDIA_ROOT = "src/public";
const MEDIA_EXTENSIONS = [
  ".png",
  ".webp",
  ".svg",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
];

const VIEWS_FILE = "src/data/blog-views.json";

function hasExtension(path: string, extensions: string[]): boolean {
  return extensions.some((extension) => path.endsWith(extension));
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });

  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // `parentPath` is absolute; make every recorded path repository-relative so
    // the artifact does not depend on where the repository is checked out.
    files.push(relative(process.cwd(), join(entry.parentPath, entry.name)));
  }

  return files;
}

async function fingerprintFiles(paths: string[]): Promise<FileFingerprint[]> {
  const fingerprints = await Promise.all(
    paths.map(async (path) => {
      const contents = await readFile(path);
      return {
        // POSIX separators keep the artifact identical across platforms.
        path: path.split(sep).join("/"),
        bytes: contents.byteLength,
        sha256: sha256(contents),
      };
    })
  );

  return fingerprints.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

export async function fingerprintContent(): Promise<FileFingerprint[]> {
  const paths: string[] = [];

  for (const root of CONTENT_ROOTS) {
    const files = await listFiles(root.directory);
    paths.push(...files.filter((file) => hasExtension(file, root.extensions)));
  }

  // Tests describe the code, not the content a Visitor sees.
  return fingerprintFiles(paths.filter((path) => !path.includes(".test.")));
}

export async function fingerprintMedia(): Promise<FileFingerprint[]> {
  const files = await listFiles(MEDIA_ROOT);
  return fingerprintFiles(
    files.filter((file) => hasExtension(file, MEDIA_EXTENSIONS))
  );
}

export async function fingerprintViews(): Promise<ViewFingerprint> {
  const perSlug = await readViewCounts();
  const slugs = Object.keys(perSlug).sort();

  return {
    source: VIEWS_FILE,
    perSlug: Object.fromEntries(slugs.map((slug) => [slug, perSlug[slug]!])),
    total: slugs.reduce((sum, slug) => sum + perSlug[slug]!, 0),
  };
}

async function readViewCounts(): Promise<Record<string, number>> {
  try {
    await stat(VIEWS_FILE);
  } catch {
    return {};
  }

  const parsed: unknown = JSON.parse(await readFile(VIEWS_FILE, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${VIEWS_FILE} must contain a JSON object of view counts`);
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 0
    )
  );
}
