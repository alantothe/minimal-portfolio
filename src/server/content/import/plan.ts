/**
 * Deciding what the import would write, without writing any of it.
 *
 * #36 requires the *complete graph* to validate before the write transaction
 * opens: schemas, unique slugs, routes, media resolution, links, Markdown, and
 * view-count ownership. Planning is therefore a separate phase with its own
 * return value, not a loop that inserts as it goes. A partial import is
 * explicitly forbidden, and the cheapest way to guarantee that is for the
 * writing phase to have nothing left to decide.
 *
 * The plan is also what makes a dry run meaningful. A dry run is not a
 * different code path with its own bugs — it is this function, printed instead
 * of committed.
 *
 * Media is reached through a port. Turning `/avatar.webp` into a Media record
 * means uploading it, and turning the Questurian URL into one means asking the
 * Cloudinary Admin API; both need credentials that a rehearsal does not have.
 * The port lets rehearsals run against a deterministic stub while production
 * runs against the real provider, with identical planning logic either way.
 */

import {
  importedContentId,
  SINGLETON_IDS,
  type ContentType,
} from "../identity";
import { parseContentData, type ContentData } from "../schema";
import {
  hasBlockingError,
  validateViewCount,
  type Finding,
} from "../validation";
import { convertShortCopy, stripLeadingHeading } from "./convert";
import type { LegacySources, MarkdownSource } from "./sources";

/**
 * How the planner names an image it needs.
 *
 * `role` exists because one physical asset may serve two roles — #36 notes
 * `og.png` is both the default sharing image and the Minimal Portfolio card —
 * and the reconciliation report has to show both without implying two uploads.
 */
export interface MediaRequest {
  role: string;
  reference: string;
  kind: "local" | "cloudinary";
}

export interface ResolvedMedia {
  mediaAssetId: string;
  /** True when this reference resolved to an asset another role also uses. */
  shared: boolean;
}

export interface ImportMediaResolver {
  /** Uploads or finds a repository asset. Null means it could not be resolved. */
  resolveLocal(reference: string): Promise<ResolvedMedia | null>;
  /**
   * Verifies a legacy Cloudinary URL through the Admin API and records it.
   *
   * Never accepts the URL as proof of identity — see `legacyImport.ts`.
   */
  resolveCloudinary(url: string): Promise<ResolvedMedia | null>;
}

export interface PlannedEntity {
  id: string;
  type: ContentType;
  slug: string | null;
  data: ContentData;
  displayOrder: number | null;
  publishedAt: string | null;
  sourceKey: string;
  sourceHash: string;
  /** Values the importer chose rather than copied. Surfaced in the report. */
  derived: string[];
}

export interface PlannedView {
  slug: string;
  contentId: string;
  count: number;
}

export interface ImportPlan {
  fingerprint: string;
  entities: PlannedEntity[];
  media: Array<MediaRequest & { mediaAssetId: string | null }>;
  views: PlannedView[];
  findings: Finding[];
}

function error(field: string, code: string): Finding {
  return { field, code, severity: "error" };
}

function warning(field: string, code: string): Finding {
  return { field, code, severity: "warning" };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalises a frontmatter date to `YYYY-MM-DD`.
 *
 * YAML parses an unquoted date into a `Date` at UTC midnight, so formatting it
 * back through `toISOString` is lossless. A quoted one arrives as a string and
 * is passed through for the validator to judge.
 */
function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  return text(value);
}

function projectGallery(
  value: unknown,
  fallbackAlt: string
): Array<{ src: string; alt: string }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ src: entry, alt: fallbackAlt }];
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const item = entry as Record<string, unknown>;
    const src = text(item.src ?? item.url);
    return src ? [{ src, alt: text(item.alt) || fallbackAlt }] : [];
  });
}

function projectVideoUrl(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return text((value as Record<string, unknown>).src) || null;
}

function projectTechnologies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Legacy image references the importer knows how to adopt. */
function classifyImageReference(
  reference: string
): MediaRequest["kind"] | null {
  if (reference.startsWith("/") && !reference.startsWith("//")) return "local";
  if (reference.startsWith("https://res.cloudinary.com/")) return "cloudinary";
  // #36: unknown remote images fail closed.
  return null;
}

interface PlanContext {
  sources: LegacySources;
  resolver: ImportMediaResolver;
  config: LegacyConfig;
  findings: Finding[];
  media: Map<string, { request: MediaRequest; mediaAssetId: string | null }>;
  roles: MediaRequest[];
}

/** The shape the planner needs out of `src/config/index.ts`. */
export interface LegacyConfig {
  logoPath: string;
  author: {
    name: string;
    email: string;
    githubUsername: string;
    photo: string;
  };
  professional: { title: string; intro: string; bio: string };
  about: {
    intro: string;
    hobbies: string;
    socialLinks: Array<{ name?: string; label?: string; url: string }>;
    featuredTitle: string;
    featuredParagraphs: string[];
  };
}

/**
 * Records an image the plan needs, de-duplicating by reference.
 *
 * Two roles pointing at the same file must produce one Media asset and two
 * references to it, not two uploads of identical bytes.
 */
async function requestMedia(
  context: PlanContext,
  role: string,
  reference: string
): Promise<string | null> {
  const kind = classifyImageReference(reference);

  if (kind === null) {
    context.findings.push(error(role, "unsupported_image_reference"));
    return null;
  }

  const request: MediaRequest = { role, reference, kind };
  context.roles.push(request);

  const existing = context.media.get(reference);
  if (existing) {
    return existing.mediaAssetId;
  }

  const resolved =
    kind === "local"
      ? await context.resolver.resolveLocal(reference)
      : await context.resolver.resolveCloudinary(reference);

  if (!resolved) {
    context.findings.push(error(role, "media_unresolved"));
    context.media.set(reference, { request, mediaAssetId: null });
    return null;
  }

  context.media.set(reference, {
    request,
    mediaAssetId: resolved.mediaAssetId,
  });
  return resolved.mediaAssetId;
}

function mediaReference(
  mediaAssetId: string | null,
  alt: string
): { mediaAssetId: string; alt: string } | null {
  return mediaAssetId === null ? null : { mediaAssetId, alt };
}

/** SEO overrides are seeded null so today's fallbacks stay in charge. */
const NO_SEO = { title: null, description: null, sharingImage: null };

async function planHome(context: PlanContext): Promise<PlannedEntity> {
  const { config, sources } = context;
  const derived: string[] = [];

  const intro = convertShortCopy("introMarkdown", config.professional.intro, {
    contactEmail: config.author.email,
  });
  const bio = convertShortCopy("bioMarkdown", config.professional.bio, {
    contactEmail: config.author.email,
  });

  context.findings.push(...intro.findings, ...bio.findings);

  const portraitId = await requestMedia(
    context,
    "home.portrait",
    config.author.photo
  );

  // The legacy portrait carries the author's name as its alt text; keeping that
  // is preservation, not invention.
  const data = {
    displayName: config.author.name,
    email: config.author.email,
    githubUsername: config.author.githubUsername,
    professionalTitle: config.professional.title,
    introMarkdown: intro.markdown,
    bioMarkdown: bio.markdown,
    portrait: mediaReference(portraitId, config.author.name),
    seo: NO_SEO,
  };

  return {
    id: SINGLETON_IDS.home,
    type: "home",
    slug: null,
    data: validated(context, "home", data, "home"),
    displayOrder: null,
    publishedAt: null,
    sourceKey: sources.config.path,
    sourceHash: sources.config.sha256,
    derived,
  };
}

async function planAbout(context: PlanContext): Promise<PlannedEntity> {
  const { config, sources } = context;

  const contact = { contactEmail: config.author.email };
  const intro = convertShortCopy("introMarkdown", config.about.intro, contact);
  const hobbies = convertShortCopy(
    "hobbiesMarkdown",
    config.about.hobbies,
    contact
  );

  // #36: the three description fields become one Markdown body. Paragraph
  // breaks preserve the visible structure exactly.
  const featured = convertShortCopy(
    "featuredBodyMarkdown",
    config.about.featuredParagraphs.join("\n\n"),
    contact
  );

  context.findings.push(
    ...intro.findings,
    ...hobbies.findings,
    ...featured.findings
  );

  const data = {
    introMarkdown: intro.markdown,
    hobbiesMarkdown: hobbies.markdown,
    socialLinks: config.about.socialLinks.map((link) => ({
      // Legacy calls it `name`; the model calls it `label`.
      label: text(link.label ?? link.name),
      url: link.url,
    })),
    featuredTitle: config.about.featuredTitle,
    featuredBodyMarkdown: featured.markdown,
    seo: NO_SEO,
  };

  return {
    id: SINGLETON_IDS.about,
    type: "about",
    slug: null,
    data: validated(context, "about", data, "about"),
    displayOrder: null,
    publishedAt: null,
    sourceKey: sources.config.path,
    sourceHash: sources.config.sha256,
    derived: [],
  };
}

async function planBranding(context: PlanContext): Promise<PlannedEntity> {
  const { config, sources } = context;

  const logoId = await requestMedia(context, "branding.logo", config.logoPath);
  const sharingId = await requestMedia(
    context,
    "branding.defaultSharingImage",
    "/public/og.png"
  );

  const data = {
    logo: mediaReference(logoId, config.author.name),
    defaultSharingImage: mediaReference(sharingId, config.author.name),
  };

  return {
    id: SINGLETON_IDS.branding,
    type: "branding",
    slug: null,
    data: validated(context, "branding", data, "branding"),
    displayOrder: null,
    publishedAt: null,
    sourceKey: sources.config.path,
    sourceHash: sources.config.sha256,
    derived: ["branding.logo.alt", "branding.defaultSharingImage.alt"],
  };
}

async function planProject(
  context: PlanContext,
  source: MarkdownSource
): Promise<PlannedEntity> {
  const front = source.frontmatter;
  const title = text(front.title);
  const derived: string[] = [];

  let cardId: string | null = null;
  const image = text(front.image);
  if (image !== "") {
    cardId = await requestMedia(context, `project.${source.key}.card`, image);
    // The legacy card renders with an empty alt. #32 requires alt text to
    // publish a meaningful image, so the title is used and reported as derived
    // rather than quietly invented.
    derived.push(`project.${source.key}.card.alt`);
  }

  const gallery: Array<{ mediaAssetId: string; alt: string }> = [];
  for (const [index, item] of projectGallery(front.gallery, title).entries()) {
    const galleryId = await requestMedia(
      context,
      `project.${source.key}.gallery[${index}]`,
      item.src
    );
    const reference = mediaReference(galleryId, item.alt);
    if (reference) gallery.push(reference);
  }

  const order = front.order;

  const data = {
    title,
    summary: text(front.description),
    technologies: projectTechnologies(front.technologies ?? front.stack),
    card: mediaReference(cardId, title),
    gallery,
    videoUrl: projectVideoUrl(front.video),
    bodyMarkdown: source.body.trim(),
    seo: NO_SEO,
  };

  if (typeof order !== "number" || !Number.isSafeInteger(order)) {
    context.findings.push(
      error(`project.${source.key}.order`, "invalid_order")
    );
  }

  return {
    id: importedContentId("project", source.key),
    type: "project",
    slug: source.key,
    data: validated(context, "project", data, `project.${source.key}`),
    displayOrder: typeof order === "number" ? order : null,
    publishedAt: null,
    sourceKey: source.path,
    sourceHash: source.sha256,
    derived,
  };
}

function planBlogPost(
  context: PlanContext,
  source: MarkdownSource
): PlannedEntity {
  const front = source.frontmatter;
  const title = text(front.title);

  const heading = stripLeadingHeading(source.body, title);

  if (heading.status === "mismatch") {
    // #36: any mismatch stops the import for manual review rather than
    // discarding a heading the author wrote.
    context.findings.push(
      error(`blog.${source.key}.body`, "leading_heading_mismatch")
    );
  }

  const data = {
    title,
    excerpt: text(front.excerpt),
    bodyMarkdown:
      heading.status === "mismatch" ? source.body.trim() : heading.body,
    sharingImage: null,
    seo: NO_SEO,
  };

  return {
    id: importedContentId("blog_post", source.key),
    type: "blog_post",
    slug: source.key,
    data: validated(context, "blog_post", data, `blog.${source.key}`),
    displayOrder: null,
    publishedAt: isoDate(front.date),
    sourceKey: source.path,
    sourceHash: source.sha256,
    derived:
      heading.status === "stripped" ? [`blog.${source.key}.leadingH1`] : [],
  };
}

/**
 * Runs the content through the same parser the API uses, at publish severity.
 *
 * #42 requires the importer to use the application's own validators rather than
 * its own copy. Anything that would be refused at publish is refused at import,
 * because importing content the Owner then could not publish is not a migration.
 */
function validated(
  context: PlanContext,
  type: ContentType,
  data: unknown,
  label: string
): ContentData {
  const parsed = parseContentData(type, data, "publish");

  context.findings.push(
    ...parsed.findings.map((finding) => ({
      ...finding,
      field: `${label}.${finding.field}`,
    }))
  );

  return parsed.data;
}

function planViews(
  context: PlanContext,
  entities: PlannedEntity[]
): PlannedView[] {
  const bySlug = new Map(
    entities
      .filter((entity) => entity.type === "blog_post")
      .map((entity) => [entity.slug!, entity.id])
  );

  const views: PlannedView[] = [];

  for (const [slug, raw] of Object.entries(context.sources.views.counts)) {
    if (slug === "__malformed__") {
      context.findings.push(error("views", "malformed_view_store"));
      continue;
    }

    const contentId = bySlug.get(slug);

    if (!contentId) {
      // #36 rejects orphan view slugs. A count with no post means either the
      // post was deleted or the slug changed, and guessing which would attach
      // somebody's traffic to the wrong article.
      context.findings.push(error(`views.${slug}`, "orphan_view_slug"));
      continue;
    }

    const countFindings = validateViewCount(`views.${slug}`, raw);
    if (countFindings.length > 0) {
      context.findings.push(...countFindings);
      continue;
    }

    views.push({ slug, contentId, count: raw as number });
  }

  return views;
}

/** Route collisions, checked across the whole graph rather than per item. */
function checkRoutes(context: PlanContext, entities: PlannedEntity[]): void {
  const seen = new Map<string, string>();

  for (const entity of entities) {
    if (entity.slug === null) continue;

    const route =
      entity.type === "project"
        ? `/projects/${entity.slug}`
        : `/blog/${entity.slug}`;

    const previous = seen.get(route);
    if (previous) {
      context.findings.push(error(route, "duplicate_route"));
      continue;
    }

    seen.set(route, entity.id);
  }

  const ids = entities.map((entity) => entity.id);
  if (new Set(ids).size !== ids.length) {
    // Would mean two sources derived the same UUIDv5, which should be
    // impossible; checked because the cost of being wrong is a silent overwrite.
    context.findings.push(error("entities", "duplicate_entity_id"));
  }
}

export async function planImport(
  sources: LegacySources,
  config: LegacyConfig,
  resolver: ImportMediaResolver
): Promise<ImportPlan> {
  const context: PlanContext = {
    sources,
    resolver,
    config,
    findings: [],
    media: new Map(),
    roles: [],
  };

  const entities: PlannedEntity[] = [
    await planHome(context),
    await planAbout(context),
    await planBranding(context),
  ];

  for (const source of sources.projects) {
    entities.push(await planProject(context, source));
  }

  for (const source of sources.blogPosts) {
    entities.push(planBlogPost(context, source));
  }

  const views = planViews(context, entities);
  checkRoutes(context, entities);

  const media = context.roles.map((request) => ({
    ...request,
    mediaAssetId: context.media.get(request.reference)?.mediaAssetId ?? null,
  }));

  if (entities.filter((entity) => entity.type === "blog_post").length === 0) {
    context.findings.push(warning("blogPosts", "no_blog_posts_found"));
  }

  return {
    fingerprint: sources.fingerprint,
    entities,
    media,
    views,
    findings: context.findings,
  };
}

export function planIsWritable(plan: ImportPlan): boolean {
  return !hasBlockingError(plan.findings);
}
