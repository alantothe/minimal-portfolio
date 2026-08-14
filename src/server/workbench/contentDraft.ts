/**
 * Read/save contract for singleton Content drafts.
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
import { SINGLETON_IDS, type SingletonType } from "../content/identity";
import {
  parseContentData,
  type AboutContent,
  type BrandingContent,
  type ContentData,
  type HomeContent,
  type MediaReference,
} from "../content/schema";
import { hasBlockingError, type Finding } from "../content/validation";
import type { RefreshOutcome } from "../published/site";

export interface DraftRecord {
  id: string;
  type: SingletonType;
  data: ContentData;
  updatedAt: string;
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
  | { status: "conflict"; currentUpdatedAt: string }
  | { status: "not-found" };

export interface DraftDependencies {
  content: ContentRepository;
  media: MediaRepository;
  refreshPreview: () => RefreshOutcome | null;
}

export function singletonTypeForId(id: string): SingletonType | null {
  for (const [type, singletonId] of Object.entries(SINGLETON_IDS)) {
    if (id === singletonId) return type as SingletonType;
  }
  return null;
}

function mediaReferences(
  type: SingletonType,
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
  }
}

function validateMedia(
  type: SingletonType,
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

function toDraft(item: ContentItem, type: SingletonType): DraftRecord {
  const parsed = parseContentData(type, item.data, "draft");
  return {
    id: item.id,
    type,
    data: parsed.data,
    updatedAt: item.updatedAt,
    publishFindings: parseContentData(type, parsed.data, "publish").findings,
  };
}

export function readSingletonDraft(
  id: string,
  content: ContentRepository
): ReadDraftOutcome {
  const type = singletonTypeForId(id);
  if (!type) return { status: "not-found" };

  const item = content.findById(id);
  return item
    ? { status: "found", draft: toDraft(item, type) }
    : { status: "not-found" };
}

export function saveSingletonDraft(
  input: { id: string; data: unknown; expectedUpdatedAt: string },
  dependencies: DraftDependencies
): SaveDraftOutcome {
  const type = singletonTypeForId(input.id);
  if (!type) return { status: "not-found" };

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
  if (hasBlockingError(findings)) {
    return { status: "invalid", findings };
  }

  const update = dependencies.content.updateIfCurrent(
    input.id,
    { data: parsed.data },
    "owner",
    input.expectedUpdatedAt
  );
  if (update.status !== "updated") return update;

  return {
    status: "saved",
    draft: toDraft(update.item, type),
    preview: dependencies.refreshPreview(),
  };
}
