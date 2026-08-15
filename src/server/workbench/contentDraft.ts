/**
 * Read/save contract for editable Content drafts.
 *
 * HTTP, authentication, and CSRF live outside this module. Keeping the contract
 * here lets tests drive real SQLite while making network-shaped failures
 * explicit: invalid content, stale version, missing item, or successful save.
 */

import {
  ContentRepository,
  type ContentItem,
} from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { isSingletonType, type ContentType } from "../content/identity";
import { validateContentAddress } from "../content/address";
import {
  parseContentData,
  type AboutContent,
  type BrandingContent,
  type ContentData,
  type HomeContent,
  type MediaReference,
  type ProjectContent,
  type BlogPostContent,
} from "../content/schema";
import {
  hasBlockingError,
  normalizeText,
  type Finding,
  type ValidationMode,
} from "../content/validation";
import type { RefreshOutcome } from "../published/site";

export interface DraftRecord {
  id: string;
  type: ContentType;
  data: ContentData;
  slug: string | null;
  displayOrder: number | null;
  publishedAt: string | null;
  updatedAt: string;
  draftVersion: number;
  publishFindings: Finding[];
}

export type ReadDraftOutcome =
  { status: "found"; draft: DraftRecord } | { status: "not-found" };

export type SaveDraftOutcome =
  | {
      status: "saved";
      draft: DraftRecord;
      preview: RefreshOutcome | null;
    }
  | { status: "invalid"; findings: Finding[] }
  | {
      status: "conflict";
      currentDraftVersion: number;
    }
  | { status: "not-found" };

export interface DraftReadDependencies {
  content: ContentRepository;
  media: MediaRepository;
}

export interface DraftDependencies extends DraftReadDependencies {
  refreshPreview: () => RefreshOutcome | null;
}

function mediaReferences(
  type: ContentType,
  data: ContentData
): Array<{ field: string; reference: MediaReference | null }> {
  switch (type) {
    case "home": {
      const home = data as HomeContent;
      return [
        { field: "portrait", reference: home.portrait },
        { field: "seo.sharingImage", reference: home.seo.sharingImage },
      ];
    }
    case "about": {
      const about = data as AboutContent;
      return [{ field: "seo.sharingImage", reference: about.seo.sharingImage }];
    }
    case "branding": {
      const branding = data as BrandingContent;
      return [
        { field: "logo", reference: branding.logo },
        {
          field: "defaultSharingImage",
          reference: branding.defaultSharingImage,
        },
      ];
    }
    case "project": {
      const project = data as ProjectContent;
      return [
        { field: "card", reference: project.card },
        { field: "seo.sharingImage", reference: project.seo.sharingImage },
      ];
    }
    case "blog_post": {
      const post = data as BlogPostContent;
      return [
        { field: "sharingImage", reference: post.sharingImage },
        { field: "seo.sharingImage", reference: post.seo.sharingImage },
      ];
    }
  }
}

function validateMedia(
  type: ContentType,
  data: ContentData,
  media: MediaRepository
): Finding[] {
  const findings: Finding[] = [];

  for (const { field, reference } of mediaReferences(type, data)) {
    if (!reference) continue;
    const asset = media.findById(reference.mediaAssetId);
    if (!asset || asset.status !== "ready") {
      findings.push({ field, code: "media_unavailable", severity: "error" });
    }
  }

  return findings;
}

function addressFindings(
  item: ContentItem,
  content: ContentRepository,
  mode: ValidationMode
): Finding[] {
  const findings = validateContentAddress(item, mode);
  if (isSingletonType(item.type)) return findings;
  if (item.slug) {
    const collision = content.findBySlug(item.type, item.slug);
    if (collision && collision.id !== item.id) {
      findings.push({
        field: "slug",
        code: "duplicate_slug",
        severity: "error",
      });
    }
  }

  return findings;
}

/** Complete publish-mode validation for one candidate revision. */
export function publicationFindings(
  item: ContentItem,
  dependencies: DraftReadDependencies
): Finding[] {
  const parsed = parseContentData(item.type, item.data, "draft");
  return [
    ...parseContentData(item.type, parsed.data, "publish").findings,
    ...addressFindings(item, dependencies.content, "publish"),
    ...validateMedia(item.type, parsed.data, dependencies.media),
  ];
}

function toDraft(
  item: ContentItem,
  dependencies: DraftReadDependencies
): DraftRecord {
  const type = item.type;
  const parsed = parseContentData(type, item.data, "draft");
  const publish = parseContentData(type, parsed.data, "publish").findings;
  return {
    id: item.id,
    type,
    data: parsed.data,
    slug: item.slug,
    displayOrder: item.displayOrder,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
    draftVersion: item.draftVersion,
    publishFindings: [
      ...publish,
      ...addressFindings(item, dependencies.content, "publish"),
      ...validateMedia(type, parsed.data, dependencies.media),
    ],
  };
}

export function readContentDraft(
  id: string,
  dependencies: DraftReadDependencies
): ReadDraftOutcome {
  const item = dependencies.content.findById(id);
  return item
    ? { status: "found", draft: toDraft(item, dependencies) }
    : { status: "not-found" };
}

export function saveContentDraft(
  input: {
    id: string;
    data: unknown;
    attributes?: {
      slug?: unknown;
      displayOrder?: unknown;
      publishedAt?: unknown;
    };
    expectedDraftVersion: number;
  },
  dependencies: DraftDependencies
): SaveDraftOutcome {
  const current = dependencies.content.findById(input.id);
  if (!current) return { status: "not-found" };
  const type = current.type;
  const attributes = input.attributes ?? {};
  const allowedAttributes = isSingletonType(type)
    ? new Set<string>()
    : type === "project"
      ? new Set(["slug", "displayOrder"])
      : new Set(["slug", "publishedAt"]);
  const unexpectedAttribute = Object.keys(attributes).find(
    (key) => !allowedAttributes.has(key)
  );
  if (unexpectedAttribute) {
    return {
      status: "invalid",
      findings: [
        {
          field: `attributes.${unexpectedAttribute}`,
          code: "unknown_field",
          severity: "error",
        },
      ],
    };
  }

  let parsed;
  try {
    parsed = parseContentData(type, input.data, "draft");
  } catch {
    return {
      status: "invalid",
      findings: [{ field: "data", code: "expected_object", severity: "error" }],
    };
  }

  const findings = [
    ...parsed.findings,
    ...validateMedia(type, parsed.data, dependencies.media),
  ];

  const changes: {
    data: ContentData;
    slug?: string;
    displayOrder?: number | null;
    publishedAt?: string | null;
  } = { data: parsed.data };

  if (!isSingletonType(type)) {
    changes.slug =
      "slug" in attributes
        ? normalizeText(
            typeof attributes.slug === "string" ? attributes.slug : ""
          )
        : (current.slug ?? "");
    if (type === "project") {
      changes.displayOrder =
        "displayOrder" in attributes
          ? typeof attributes.displayOrder === "number"
            ? attributes.displayOrder
            : null
          : current.displayOrder;
    } else {
      changes.publishedAt =
        "publishedAt" in attributes
          ? typeof attributes.publishedAt === "string"
            ? normalizeText(attributes.publishedAt) || null
            : null
          : current.publishedAt;
    }

    findings.push(
      ...addressFindings(
        { ...current, ...changes },
        dependencies.content,
        "draft"
      )
    );
  }
  if (hasBlockingError(findings)) {
    return { status: "invalid", findings };
  }

  const update = dependencies.content.updateIfDraftVersion(
    input.id,
    changes,
    "owner",
    input.expectedDraftVersion
  );
  if (update.status !== "updated") return update;

  return {
    status: "saved",
    draft: toDraft(update.item, dependencies),
    preview: dependencies.refreshPreview(),
  };
}
