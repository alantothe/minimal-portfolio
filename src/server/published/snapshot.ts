/**
 * One immutable generation of the published site, built once and read many
 * times.
 *
 * #34 requires the whole generation to be assembled inside a single SQLite read
 * transaction and then frozen: ordering, pagination, canonical URLs, SEO inputs,
 * redirect lookup, and sitemap routes are all derived here, once, rather than
 * recomputed per request from rows that may have moved underneath. That is what
 * makes "SSR, JSON, SEO, redirects, pagination, and sitemap agree for one
 * generation" a structural property instead of a thing to remember.
 *
 * Markdown is rendered at build time for the same reason. Rendering per request
 * would mean a Visitor's page could contain a paragraph produced by a different
 * pass over different bytes than the ETag that describes it.
 *
 * **Building fails whole or succeeds whole.** There is no partial snapshot and
 * no per-page repair. A generation that cannot be validated is refused and the
 * previous one keeps serving, because a site that is 90% the new content and 10%
 * the old is a state nobody wrote and nobody can reason about.
 */

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  ContentRepository,
  UnsupportedSchemaVersionError,
  type ContentItem,
} from "../database/contentRepository";
import { MediaRepository, type MediaAsset } from "../database/mediaRepository";
import { parseContentData } from "../content/schema";
import type {
  AboutContent,
  BlogPostContent,
  BrandingContent,
  HomeContent,
  MediaReference,
  ProjectContent,
  SeoOverrides,
} from "../content/schema";
import { renderMarkdown, type MarkdownContext } from "../content/markdown";
import { hasBlockingError, type Finding } from "../content/validation";
import { renderMedia } from "../media/delivery";
import { resolveMediaConfig, type MediaVariant } from "../media/config";
import { BLOG_PAGE_SIZE, PROJECT_PAGE_SIZE } from "../services/collectionPages";
import { toInlineHtml } from "./inlineCopy";

/**
 * Which variant each role renders at.
 *
 * Centralised because the choice is a property of the *role*, not of the asset
 * or of whoever is rendering. A sharing image and a project card are different
 * shapes for different consumers, and letting each call site pick would let two
 * renderers of the same page disagree about the box an image occupies.
 *
 * `portfolio_wide` is a `limit`, so it never upscales and never crops: correct
 * for logos and sharing images, where a 1200x630 card cropped to a square would
 * be a silent regression in every social preview.
 */
export const ROLE_VARIANTS = {
  portrait: "portfolio_avatar",
  logo: "portfolio_wide",
  sharing: "portfolio_wide",
  card: "portfolio_card",
} as const satisfies Record<string, MediaVariant>;

export type MediaRole = keyof typeof ROLE_VARIANTS;

/** An image resolved to something a page can actually place. */
export interface PublishedImage {
  mediaAssetId: string;
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface PublishedSocialLink {
  label: string;
  url: string;
}

/**
 * The published SEO overrides.
 *
 * Kept as overrides rather than resolved metadata: the fallbacks depend on the
 * origin, which belongs to configuration and not to a stored generation.
 */
export interface PublishedSeo {
  title: string | null;
  description: string | null;
  sharingImage: PublishedImage | null;
}

export interface PublishedHome {
  displayName: string;
  /** Derived at render time per #36, never stored. */
  firstName: string;
  email: string;
  githubUsername: string;
  professionalTitle: string;
  /** Inline HTML: the page template owns the surrounding paragraph element. */
  introHtml: string;
  bioHtml: string;
  portrait: PublishedImage | null;
  seo: PublishedSeo;
}

export interface PublishedAbout {
  introHtml: string;
  hobbiesHtml: string;
  socialLinks: PublishedSocialLink[];
  featuredTitle: string;
  featuredBodyParagraphs: string[];
  seo: PublishedSeo;
}

export interface PublishedBranding {
  logo: PublishedImage | null;
  defaultSharingImage: PublishedImage | null;
}

export interface PublishedProject {
  id: string;
  slug: string;
  route: string;
  title: string;
  summary: string;
  card: PublishedImage | null;
  kicker: string;
  role: string;
  status: string;
  period: string;
  technologies: string[];
  liveUrl: string | null;
  repositoryUrl: string | null;
  accentColor: string;
  bodyHtml: string;
  seo: PublishedSeo;
}

export interface PublishedBlogPost {
  id: string;
  slug: string;
  route: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  bodyHtml: string;
  sharingImage: PublishedImage | null;
  seo: PublishedSeo;
}

/**
 * A complete published generation.
 *
 * Deliberately a plain frozen value with no database handle, no lazy field, and
 * no method that could reach back to storage. Once this exists it is answerable
 * forever, which is precisely what lets a warm process keep serving after SQLite
 * becomes unreachable.
 */
export interface SiteSnapshot {
  readonly generation: string;
  readonly builtAt: string;
  readonly home: PublishedHome;
  readonly about: PublishedAbout;
  readonly branding: PublishedBranding;
  readonly projects: readonly PublishedProject[];
  readonly blogPosts: readonly PublishedBlogPost[];
  readonly blogPageSize: number;
  readonly projectPageSize: number;
  /** Every canonical route this generation answers, in sitemap order. */
  readonly routes: readonly string[];
}

export type SnapshotBuild =
  | { status: "built"; snapshot: SiteSnapshot }
  | { status: "invalid"; findings: Finding[] };

function error(field: string, code: string): Finding {
  return { field, code, severity: "error" };
}

/**
 * Resolves a Media reference to a renderable image, or to nothing.
 *
 * Returning null rather than failing the build is the Cloudinary degradation
 * rule from #34: an unconfigured or unrenderable image must not take a page
 * down. The alt text still travels with the content, so the page keeps its
 * meaning and the browser shows the designed placeholder.
 */
function resolveImage(
  reference: MediaReference | null,
  role: MediaRole,
  assets: Map<string, MediaAsset>,
  cloudName: string
): PublishedImage | null {
  if (!reference) return null;

  const asset = assets.get(reference.mediaAssetId);
  if (!asset) return null;

  const rendered = renderMedia(asset, ROLE_VARIANTS[role], cloudName);
  if (!rendered) return null;

  return {
    mediaAssetId: reference.mediaAssetId,
    url: rendered.url,
    width: rendered.width,
    height: rendered.height,
    alt: reference.alt,
  };
}

function resolveSeo(
  seo: SeoOverrides,
  assets: Map<string, MediaAsset>,
  cloudName: string
): PublishedSeo {
  return {
    title: seo.title,
    description: seo.description,
    sharingImage: resolveImage(seo.sharingImage, "sharing", assets, cloudName),
  };
}

/**
 * Renders a Markdown field, promoting any finding to a build failure.
 *
 * Stored content was validated at publish, so a finding here means the stored
 * snapshot and this release's renderer disagree — a rollback to an older
 * renderer, a media asset that has since been deleted, or a bug. Every one of
 * those is a reason to keep serving the previous generation rather than to
 * publish a page with a paragraph quietly missing from it.
 */
function renderField(
  label: string,
  source: string,
  profile: "short" | "body",
  context: MarkdownContext,
  findings: Finding[]
): string {
  const rendered = renderMarkdown(label, source, profile, context);
  findings.push(...rendered.findings);
  return rendered.html;
}

function firstNameOf(displayName: string): string {
  return displayName.split(/\s+/)[0] ?? displayName;
}

/**
 * Splits a rendered short body back into its paragraphs.
 *
 * The About page template places each paragraph in its own styled element, so
 * the renderer has to hand back the pieces rather than one blob. Splitting the
 * rendered HTML — rather than the Markdown source — keeps the paragraph boundary
 * defined by the same parser that produced the markup.
 */
function splitParagraphs(html: string): string[] {
  return Array.from(html.matchAll(/<p>([\s\S]*?)<\/p>/g), (match) => match[1]!);
}

interface BuildContext {
  assets: Map<string, MediaAsset>;
  cloudName: string;
  findings: Finding[];
  markdown: MarkdownContext;
}

function parsed<T>(
  item: ContentItem,
  type: Parameters<typeof parseContentData>[0],
  context: BuildContext
): T {
  const result = parseContentData(type, item.data, "publish");

  context.findings.push(
    ...result.findings.map((finding) => ({
      ...finding,
      field: `${item.id}.${finding.field}`,
    }))
  );

  return result.data as T;
}

function buildHome(item: ContentItem, context: BuildContext): PublishedHome {
  const data = parsed<HomeContent>(item, "home", context);
  const { assets, cloudName, findings, markdown } = context;

  return {
    displayName: data.displayName,
    firstName: firstNameOf(data.displayName),
    email: data.email,
    githubUsername: data.githubUsername,
    professionalTitle: data.professionalTitle,
    introHtml: toInlineHtml(
      renderField("home.intro", data.introMarkdown, "short", markdown, findings)
    ),
    bioHtml: toInlineHtml(
      renderField("home.bio", data.bioMarkdown, "short", markdown, findings)
    ),
    portrait: resolveImage(data.portrait, "portrait", assets, cloudName),
    seo: resolveSeo(data.seo, assets, cloudName),
  };
}

function buildAbout(item: ContentItem, context: BuildContext): PublishedAbout {
  const data = parsed<AboutContent>(item, "about", context);
  const { assets, cloudName, findings, markdown } = context;

  return {
    introHtml: toInlineHtml(
      renderField(
        "about.intro",
        data.introMarkdown,
        "short",
        markdown,
        findings
      )
    ),
    hobbiesHtml: toInlineHtml(
      renderField(
        "about.hobbies",
        data.hobbiesMarkdown,
        "short",
        markdown,
        findings
      )
    ),
    socialLinks: data.socialLinks.map((link) => ({
      label: link.label,
      url: link.url,
    })),
    featuredTitle: data.featuredTitle,
    featuredBodyParagraphs: splitParagraphs(
      renderField(
        "about.featuredBody",
        data.featuredBodyMarkdown,
        "short",
        markdown,
        findings
      )
    ),
    seo: resolveSeo(data.seo, assets, cloudName),
  };
}

function buildBranding(
  item: ContentItem,
  context: BuildContext
): PublishedBranding {
  const data = parsed<BrandingContent>(item, "branding", context);
  const { assets, cloudName } = context;

  return {
    logo: resolveImage(data.logo, "logo", assets, cloudName),
    defaultSharingImage: resolveImage(
      data.defaultSharingImage,
      "sharing",
      assets,
      cloudName
    ),
  };
}

function buildProject(
  item: ContentItem,
  context: BuildContext
): PublishedProject {
  const data = parsed<ProjectContent>(item, "project", context);
  const { assets, cloudName, findings, markdown } = context;
  const slug = item.slug!;

  return {
    id: item.id,
    slug,
    route: `/projects/${encodeURIComponent(slug)}`,
    title: data.title,
    summary: data.summary,
    card: resolveImage(data.card, "card", assets, cloudName),
    kicker: data.kicker,
    role: data.role,
    status: data.status,
    period: data.period,
    technologies: [...data.technologies],
    liveUrl: data.liveUrl,
    repositoryUrl: data.repositoryUrl,
    accentColor: data.accentColor,
    bodyHtml: renderField(
      `project.${slug}.body`,
      data.bodyMarkdown,
      "body",
      markdown,
      findings
    ),
    seo: resolveSeo(data.seo, assets, cloudName),
  };
}

function buildBlogPost(
  item: ContentItem,
  context: BuildContext
): PublishedBlogPost {
  const data = parsed<BlogPostContent>(item, "blog_post", context);
  const { assets, cloudName, findings, markdown } = context;
  const slug = item.slug!;

  return {
    id: item.id,
    slug,
    route: `/blog/${encodeURIComponent(slug)}`,
    title: data.title,
    excerpt: data.excerpt,
    publishedAt: item.publishedAt,
    bodyHtml: renderField(
      `blog.${slug}.body`,
      data.bodyMarkdown,
      "body",
      markdown,
      findings
    ),
    sharingImage: resolveImage(data.sharingImage, "sharing", assets, cloudName),
    seo: resolveSeo(data.seo, assets, cloudName),
  };
}

/** Every Media id any piece of content points at, including inside Markdown. */
function collectMediaIds(items: ContentItem[]): Set<string> {
  const ids = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value === null || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (typeof record.mediaAssetId === "string" && record.mediaAssetId !== "") {
      ids.add(record.mediaAssetId);
    }

    Object.values(record).forEach(walk);
  };

  for (const item of items) {
    walk(item.data);

    // Inline images name their asset as `media:<id>` inside Markdown, which the
    // structural walk above cannot see.
    for (const field of Object.values(
      (item.data as Record<string, unknown>) ?? {}
    )) {
      if (typeof field !== "string") continue;
      for (const match of field.matchAll(/media:([0-9a-zA-Z-]{8,})/g)) {
        ids.add(match[1]!);
      }
    }
  }

  return ids;
}

/**
 * The identity of a generation.
 *
 * Hashed from the stored rows rather than from the rendered output, so the same
 * content always produces the same generation id no matter which release built
 * it. Media rows are included because replacing an image changes what a page
 * shows without touching any content row, and a generation id that missed that
 * would let a stale ETag survive an image change.
 */
function computeGeneration(items: ContentItem[], assets: MediaAsset[]): string {
  const hash = createHash("sha256");

  for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    hash.update(
      JSON.stringify([
        item.id,
        item.type,
        item.slug,
        item.schemaVersion,
        item.displayOrder,
        item.publishedAt,
        item.updatedAt,
      ])
    );
    hash.update(stableStringify(item.data));
  }

  for (const asset of [...assets].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    hash.update(
      JSON.stringify([
        asset.id,
        asset.providerPublicId,
        asset.providerVersion,
        asset.format,
        asset.width,
        asset.height,
        asset.status,
      ])
    );
  }

  return hash.digest("hex").slice(0, 32);
}

/** Key order belongs to whoever built the object, not to the content. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function collectionRoutes(
  basePath: "/blog" | "/projects",
  itemCount: number,
  pageSize: number
): string[] {
  const totalPages = Math.max(1, Math.ceil(itemCount / pageSize));

  return Array.from({ length: totalPages }, (_, index) =>
    index === 0 ? basePath : `${basePath}?page=${index + 1}`
  );
}

export interface BuildOptions {
  /**
   * Overrides the delivery cloud. Tests supply one; production reads media
   * configuration, where absent credentials mean images do not render rather
   * than that the build fails.
   */
  cloudName?: string;
  now?: Date;
}

/**
 * Reads the current content and builds one generation.
 *
 * Everything happens inside one transaction so the snapshot describes a single
 * consistent point in time. A publish committing halfway through must not
 * produce a generation with the new Home and the old Projects.
 */
export function buildSiteSnapshot(
  database: Database,
  options: BuildOptions = {}
): SnapshotBuild {
  const content = new ContentRepository(database);
  const media = new MediaRepository(database);
  const findings: Finding[] = [];

  let items: ContentItem[];
  let assetList: MediaAsset[];

  try {
    ({ items, assetList } = database.transaction(() => {
      const loaded = [
        ...content.list("home"),
        ...content.list("about"),
        ...content.list("branding"),
        ...content.list("project"),
        ...content.list("blog_post"),
      ];

      const assets: MediaAsset[] = [];
      for (const id of collectMediaIds(loaded)) {
        const asset = media.findById(id);
        if (asset) assets.push(asset);
      }

      return { items: loaded, assetList: assets };
    })());
  } catch (cause) {
    // An unsupported schema version is the expected shape of this failure and
    // #34 requires it to fail closed rather than render content this release
    // cannot fully interpret.
    if (cause instanceof UnsupportedSchemaVersionError) {
      return {
        status: "invalid",
        findings: [error(cause.contentId, "unsupported_schema_version")],
      };
    }

    return {
      status: "invalid",
      findings: [
        error("snapshot", "content_read_failed"),
        error(
          "snapshot.detail",
          cause instanceof Error ? cause.message : String(cause)
        ),
      ],
    };
  }

  const byType = (type: ContentItem["type"]) =>
    items.filter((item) => item.type === type);

  const home = byType("home")[0];
  const about = byType("about")[0];
  const branding = byType("branding")[0];

  // The three singletons are the site's skeleton. Missing one is not a page
  // that fails to render, it is a generation that cannot exist.
  if (!home) findings.push(error("home", "singleton_missing"));
  if (!about) findings.push(error("about", "singleton_missing"));
  if (!branding) findings.push(error("branding", "singleton_missing"));

  if (!home || !about || !branding) {
    return { status: "invalid", findings };
  }

  const resolution = resolveMediaConfig();
  const cloudName =
    options.cloudName ??
    (resolution.status === "configured" ? resolution.config.cloudName : "");

  const assets = new Map(assetList.map((asset) => [asset.id, asset]));

  const context: BuildContext = {
    assets,
    cloudName,
    findings,
    markdown: {
      resolveMedia: (mediaAssetId) => {
        const asset = assets.get(mediaAssetId);
        if (!asset) return null;
        return renderMedia(asset, "portfolio_wide", cloudName);
      },
    },
  };

  const publishedHome = buildHome(home, context);
  const publishedAbout = buildAbout(about, context);
  const publishedBranding = buildBranding(branding, context);
  const projects = byType("project").map((item) => buildProject(item, context));
  const blogPosts = byType("blog_post").map((item) =>
    buildBlogPost(item, context)
  );

  // A duplicate route would make `resolve` non-deterministic, which the unique
  // index should already prevent. Checked because the cost of being wrong is a
  // page that answers differently depending on load order.
  const routes = new Set<string>();
  for (const entry of [...projects, ...blogPosts]) {
    if (routes.has(entry.route)) {
      findings.push(error(entry.route, "duplicate_route"));
    }
    routes.add(entry.route);
  }

  if (hasBlockingError(findings)) {
    return { status: "invalid", findings };
  }

  const snapshot: SiteSnapshot = Object.freeze({
    generation: computeGeneration(items, assetList),
    builtAt: (options.now ?? new Date()).toISOString(),
    home: publishedHome,
    about: publishedAbout,
    branding: publishedBranding,
    projects: Object.freeze(projects),
    blogPosts: Object.freeze(blogPosts),
    blogPageSize: BLOG_PAGE_SIZE,
    projectPageSize: PROJECT_PAGE_SIZE,
    routes: Object.freeze([
      "/",
      "/about",
      ...collectionRoutes("/blog", blogPosts.length, BLOG_PAGE_SIZE),
      ...collectionRoutes("/projects", projects.length, PROJECT_PAGE_SIZE),
      ...blogPosts.map((post) => post.route),
      ...projects.map((project) => project.route),
    ]),
  });

  return { status: "built", snapshot };
}
