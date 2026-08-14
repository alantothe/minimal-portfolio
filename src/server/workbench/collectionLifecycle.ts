/** Creation and deletion rules for Project and Blog post drafts. */

import {
  collectionRoute,
  isSingletonType,
  newContentId,
  type CollectionType,
} from "../content/identity";
import type {
  BlogPostContent,
  ProjectContent,
  SeoOverrides,
} from "../content/schema";
import {
  hasBlockingError,
  LIMITS,
  normalizeText,
  slugFromTitle,
  suggestAvailableSlug,
  validateSlug,
  validateText,
  type Finding,
} from "../content/validation";
import {
  ContentRepository,
  type ContentItem,
} from "../database/contentRepository";
import type { RefreshOutcome } from "../published/site";

export interface CollectionLifecycleDependencies {
  content: ContentRepository;
  refreshPreview: () => RefreshOutcome | null;
}

export type CreateCollectionOutcome =
  | {
      status: "confirmation-required";
      suggestedSlug: string;
      reason: "generated" | "collision";
    }
  | {
      status: "created";
      item: ContentItem;
      route: string;
      preview: RefreshOutcome | null;
    }
  | { status: "invalid"; findings: Finding[] };

export type ArchiveCollectionOutcome =
  | {
      status: "archived";
      route: string;
      preview: RefreshOutcome | null;
    }
  | { status: "not-deletable" }
  | { status: "not-found" }
  | { status: "conflict"; currentUpdatedAt: string };

const EMPTY_SEO: SeoOverrides = {
  title: null,
  description: null,
  sharingImage: null,
};

function initialData(
  type: CollectionType,
  title: string
): ProjectContent | BlogPostContent {
  if (type === "project") {
    return {
      title,
      summary: "",
      card: null,
      kicker: "",
      role: "",
      status: "",
      period: "",
      technologies: [],
      liveUrl: null,
      repositoryUrl: null,
      accentColor: "",
      bodyMarkdown: "",
      seo: { ...EMPTY_SEO },
    };
  }

  return {
    title,
    excerpt: "",
    bodyMarkdown: "",
    sharingImage: null,
    seo: { ...EMPTY_SEO },
  };
}

function initialSlug(type: CollectionType, title: string): string {
  const derived = slugFromTitle(title);
  if (derived.length >= LIMITS.slug.min) return derived;

  const suffix = type === "project" ? "project" : "post";
  return `${derived || "new"}-${suffix}`;
}

function nextProjectOrder(content: ContentRepository): number {
  return content
    .list("project")
    .reduce((next, item) => Math.max(next, (item.displayOrder ?? -1) + 1), 0);
}

export function createCollectionDraft(
  input: { type: CollectionType; title: string; slug?: string },
  dependencies: CollectionLifecycleDependencies
): CreateCollectionOutcome {
  const title = normalizeText(input.title);
  const titleFindings = validateText("title", title, LIMITS.title, {
    required: true,
  });
  if (hasBlockingError(titleFindings)) {
    return { status: "invalid", findings: titleFindings };
  }

  const taken = dependencies.content.takenSlugs(input.type);
  const providedSlug = normalizeText(input.slug ?? "");
  if (!providedSlug) {
    return {
      status: "confirmation-required",
      suggestedSlug: suggestAvailableSlug(
        initialSlug(input.type, title),
        taken
      ),
      reason: "generated",
    };
  }

  const slugFindings = validateSlug("slug", providedSlug);
  if (hasBlockingError(slugFindings)) {
    return { status: "invalid", findings: slugFindings };
  }
  if (taken.has(providedSlug)) {
    return {
      status: "confirmation-required",
      suggestedSlug: suggestAvailableSlug(providedSlug, taken),
      reason: "collision",
    };
  }

  let item: ContentItem;
  try {
    item = dependencies.content.create({
      id: newContentId(),
      type: input.type,
      slug: providedSlug,
      data: initialData(input.type, title),
      displayOrder:
        input.type === "project"
          ? nextProjectOrder(dependencies.content)
          : null,
      publishedAt: null,
      origin: "owner",
    });
  } catch (cause) {
    // A second creation can claim the slug after the preflight check. Only
    // translate that known race; storage failures still surface as failures.
    if (dependencies.content.findBySlug(input.type, providedSlug)) {
      return {
        status: "confirmation-required",
        suggestedSlug: suggestAvailableSlug(
          providedSlug,
          dependencies.content.takenSlugs(input.type)
        ),
        reason: "collision",
      };
    }
    throw cause;
  }

  return {
    status: "created",
    item,
    route: `${collectionRoute(input.type)}/${encodeURIComponent(providedSlug)}`,
    preview: dependencies.refreshPreview(),
  };
}

export function archiveCollectionDraft(
  input: { id: string; expectedUpdatedAt: string },
  dependencies: CollectionLifecycleDependencies
): ArchiveCollectionOutcome {
  const current = dependencies.content.findById(input.id);
  if (!current || current.deletedAt !== null) return { status: "not-found" };
  if (isSingletonType(current.type)) return { status: "not-deletable" };

  const archived = dependencies.content.archiveIfCurrent(
    input.id,
    input.expectedUpdatedAt
  );
  if (archived.status !== "updated") return archived;

  return {
    status: "archived",
    route: collectionRoute(current.type),
    preview: dependencies.refreshPreview(),
  };
}
