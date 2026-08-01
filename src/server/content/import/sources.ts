/**
 * Reading what the site is made of today, and fingerprinting it.
 *
 * #36 requires the importer to calculate a SHA-256 for every source input, and
 * #42 requires the production run to check an *expected* fingerprint before it
 * writes. Both exist for the same reason: an import is a one-way operation, and
 * the only way to know it is importing what somebody reviewed is to compare a
 * hash rather than a filename.
 *
 * Sources are read from disk rather than imported as modules wherever a hash is
 * needed — `import` gives you values, not bytes, and the bytes are what the
 * fingerprint has to describe. The configuration module is the exception: it is
 * TypeScript, so its *values* are read through a normal import and its bytes
 * are hashed separately.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

export const CONFIG_SOURCE = "src/config/index.ts";
export const BLOG_DIRECTORY = "src/content/blog";
export const PROJECTS_DIRECTORY = "src/content/projects";
export const VIEWS_SOURCE = "src/data/blog-views.json";

export interface SourceFile {
  /** Repository-relative, so a fingerprint means the same thing everywhere. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface MarkdownSource extends SourceFile {
  /** Directory name for Projects, filename stem for Blog posts. */
  key: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface LegacySources {
  config: SourceFile;
  projects: MarkdownSource[];
  blogPosts: MarkdownSource[];
  views: { source: SourceFile | null; counts: Record<string, unknown> };
  /** One hash over every source hash, in a fixed order. */
  fingerprint: string;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readSourceFile(root: string, relativePath: string): SourceFile {
  const contents = readFileSync(join(root, relativePath));

  return {
    path: relativePath,
    sha256: sha256(contents),
    bytes: contents.byteLength,
  };
}

function readMarkdownSource(
  root: string,
  relativePath: string,
  key: string
): MarkdownSource {
  const file = readSourceFile(root, relativePath);
  const raw = readFileSync(join(root, relativePath), "utf8");
  const parsed = matter(raw);

  return {
    ...file,
    key,
    frontmatter: parsed.data as Record<string, unknown>,
    body: parsed.content,
  };
}

/**
 * Sorted, because the fingerprint has to be reproducible.
 *
 * `readdirSync` order is filesystem-dependent, and a fingerprint that changes
 * between a rehearsal and the production run would fail the very check it
 * exists to perform.
 */
function sortedNames(names: string[]): string[] {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function readLegacySources(root = "."): LegacySources {
  const config = readSourceFile(root, CONFIG_SOURCE);

  const projectDirectories = sortedNames(
    readdirSync(join(root, PROJECTS_DIRECTORY), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );

  const projects = projectDirectories
    .filter((name) =>
      existsSync(join(root, PROJECTS_DIRECTORY, name, "content.md"))
    )
    .map((name) =>
      readMarkdownSource(
        root,
        `${PROJECTS_DIRECTORY}/${name}/content.md`,
        // The directory name is the stable public address and therefore the
        // legacy key the entity ID is derived from.
        name
      )
    );

  const blogFiles = sortedNames(
    readdirSync(join(root, BLOG_DIRECTORY)).filter((name) =>
      name.endsWith(".md")
    )
  );

  const blogPosts = blogFiles.map((name) =>
    readMarkdownSource(
      root,
      `${BLOG_DIRECTORY}/${name}`,
      name.replace(/\.md$/, "")
    )
  );

  const viewsPath = join(root, VIEWS_SOURCE);
  let views: LegacySources["views"] = { source: null, counts: {} };

  if (existsSync(viewsPath)) {
    const source = readSourceFile(root, VIEWS_SOURCE);
    let counts: Record<string, unknown> = {};

    try {
      const parsed = JSON.parse(readFileSync(viewsPath, "utf8"));
      // Only an object of counts is meaningful. An array or a scalar means the
      // store was corrupted, and the graph validation will refuse it.
      counts =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { __malformed__: true };
    } catch {
      counts = { __malformed__: true };
    }

    views = { source, counts };
  }

  return {
    config,
    projects,
    blogPosts,
    views,
    fingerprint: fingerprintSources({ config, projects, blogPosts, views }),
  };
}

/**
 * One hash describing the whole input.
 *
 * Built from `path:sha256` pairs in a fixed order rather than from concatenated
 * file contents, so it changes when a file is *renamed* or *removed*, not only
 * when its bytes change. A removed Blog post that left the fingerprint alone
 * would be an import silently dropping content.
 */
export function fingerprintSources(
  sources: Omit<LegacySources, "fingerprint">
): string {
  const parts: string[] = [`${sources.config.path}:${sources.config.sha256}`];

  for (const entry of [...sources.projects, ...sources.blogPosts]) {
    parts.push(`${entry.path}:${entry.sha256}`);
  }

  if (sources.views.source) {
    parts.push(`${sources.views.source.path}:${sources.views.source.sha256}`);
  }

  return sha256(parts.sort().join("\n"));
}
