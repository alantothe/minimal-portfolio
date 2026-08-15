/** Owner publication, history, and restore use cases. */

import type { Database } from "bun:sqlite";
import {
  ContentRepository,
  type ContentItem,
} from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import {
  PublicationRepository,
  publicationRequestFingerprint,
  revisionChecksum,
  revisionSnapshot,
  type PublishedRevision,
} from "../database/publicationRepository";
import { SystemStateRepository } from "../database/repository";
import { hasBlockingError, type Finding } from "../content/validation";
import {
  publicationFindings,
  readContentDraft,
  type DraftRecord,
} from "./contentDraft";
import type { RefreshOutcome } from "../published/site";
import { publicRouteFor } from "../content/address";

export interface PublicationDependencies {
  database: Database;
  refreshPublished: () => RefreshOutcome | null;
  refreshPreview: () => RefreshOutcome | null;
  afterPublication?: () => void;
}

export type PublishOutcome =
  | {
      status: "published" | "replayed";
      revision: PublishedRevision;
      draft: DraftRecord;
      refresh: RefreshOutcome | null;
    }
  | { status: "disabled" }
  | { status: "invalid"; findings: Finding[] }
  | { status: "conflict"; currentDraftVersion: number }
  | { status: "idempotency-conflict" }
  | { status: "no-change"; revision: PublishedRevision }
  | { status: "not-found" };

type PublishTransactionOutcome =
  | { status: "committed"; revision: PublishedRevision }
  | { status: "replayed"; revision: PublishedRevision }
  | { status: "disabled" }
  | { status: "invalid"; findings: Finding[] }
  | { status: "conflict"; currentDraftVersion: number }
  | { status: "idempotency-conflict" }
  | { status: "no-change"; revision: PublishedRevision }
  | { status: "not-found" };

function normalizedRevisionChecksum(revision: PublishedRevision): string {
  const snapshot = revision.snapshot;
  return revisionChecksum({
    id: snapshot.id,
    type: snapshot.type,
    slug: snapshot.slug,
    schemaVersion: snapshot.schemaVersion,
    data: snapshot.data,
    displayOrder: snapshot.displayOrder,
    publishedAt: snapshot.publishedAt,
  });
}

export function publishContent(
  input: {
    contentId: string;
    expectedDraftVersion: number;
    idempotencyKey: string;
    actorGithubUserId: number;
    note?: string | null;
    now?: Date;
  },
  dependencies: PublicationDependencies
): PublishOutcome {
  const publication = new PublicationRepository(dependencies.database);
  const now = input.now ?? new Date();
  const normalizedNote = input.note?.trim() || null;
  const requestFingerprint = publicationRequestFingerprint({
    contentId: input.contentId,
    expectedDraftVersion: input.expectedDraftVersion,
    note: normalizedNote,
  });
  const outcome = dependencies.database.transaction(
    (): PublishTransactionOutcome => {
      const replay = publication.findRequest(input.idempotencyKey);
      if (replay) {
        return replay.requestFingerprint === requestFingerprint
          ? { status: "replayed", revision: replay.revision }
          : { status: "idempotency-conflict" };
      }
      if (
        new SystemStateRepository(dependencies.database).getCutoverPhase() !==
        "sealed"
      ) {
        return { status: "disabled" };
      }

      const content = new ContentRepository(dependencies.database);
      const media = new MediaRepository(dependencies.database);
      const stored = content.findById(input.contentId);
      if (!stored) return { status: "not-found" };
      if (stored.draftVersion !== input.expectedDraftVersion) {
        return { status: "conflict", currentDraftVersion: stored.draftVersion };
      }

      // The first Blog publication acquires today's UTC date if the Owner did
      // not choose one. Later publications preserve the existing date.
      const candidate: ContentItem =
        stored.type === "blog_post" &&
        stored.currentPublishedRevisionId === null &&
        stored.publishedAt === null
          ? { ...stored, publishedAt: now.toISOString().slice(0, 10) }
          : stored;
      const findings = publicationFindings(candidate, { content, media });
      const route = publicRouteFor(candidate);
      if (route) {
        const owner = publication.routeOwner(route);
        if (owner && owner !== candidate.id) {
          findings.push({
            field: "slug",
            code: "historical_route_reserved",
            severity: "error",
          });
        }
      }
      if (hasBlockingError(findings)) return { status: "invalid", findings };

      const current = publication.currentRevision(candidate.id);
      if (
        current &&
        normalizedRevisionChecksum(current) ===
          revisionChecksum(revisionSnapshot(candidate))
      ) {
        return { status: "no-change", revision: current };
      }

      const revision = publication.insertRevision({
        item: candidate,
        source: candidate.restoredFromRevisionId
          ? "restore-publish"
          : "publish",
        actorGithubUserId: input.actorGithubUserId,
        note: normalizedNote,
        idempotencyKey: input.idempotencyKey,
        expectedDraftVersion: input.expectedDraftVersion,
        requestFingerprint,
        now,
      });
      if (route) publication.activateRoute(candidate.id, route, revision.id);
      return { status: "committed", revision };
    }
  )();

  if (outcome.status === "replayed") {
    const content = new ContentRepository(dependencies.database);
    const media = new MediaRepository(dependencies.database);
    const read = readContentDraft(input.contentId, { content, media });
    if (read.status === "not-found") return { status: "not-found" };
    return { ...outcome, draft: read.draft, refresh: null };
  }
  if (outcome.status !== "committed") return outcome;

  const refresh = dependencies.refreshPublished();
  const content = new ContentRepository(dependencies.database);
  const media = new MediaRepository(dependencies.database);
  const read = readContentDraft(input.contentId, { content, media });
  if (read.status === "not-found") return { status: "not-found" };
  dependencies.afterPublication?.();
  return {
    status: "published",
    revision: outcome.revision,
    draft: read.draft,
    refresh,
  };
}

export type RestoreOutcome =
  | { status: "restored"; draft: DraftRecord; preview: RefreshOutcome | null }
  | { status: "conflict"; currentDraftVersion: number }
  | { status: "not-found" };

export function restorePublishedRevision(
  input: {
    contentId: string;
    revisionId: string;
    expectedDraftVersion: number;
    actorGithubUserId: number;
    now?: Date;
  },
  dependencies: PublicationDependencies
): RestoreOutcome {
  const publication = new PublicationRepository(dependencies.database);
  const result = dependencies.database.transaction(() => {
    const content = new ContentRepository(dependencies.database);
    const item = content.findById(input.contentId);
    const revision = publication.findRevision(input.revisionId);
    const current = item ? publication.currentRevision(item.id) : null;
    if (!item || !revision || !current || revision.contentId !== item.id)
      return { status: "not-found" } as const;
    if (item.draftVersion !== input.expectedDraftVersion) {
      return {
        status: "conflict",
        currentDraftVersion: item.draftVersion,
      } as const;
    }
    const version = publication.restoreRevision({
      revision,
      currentPublicSlug: current.snapshot.slug,
      expectedDraftVersion: input.expectedDraftVersion,
      actorGithubUserId: input.actorGithubUserId,
      now: input.now ?? new Date(),
    });
    return version === null
      ? ({
          status: "conflict",
          currentDraftVersion: item.draftVersion,
        } as const)
      : ({ status: "restored" } as const);
  })();
  if (result.status !== "restored") return result;

  const content = new ContentRepository(dependencies.database);
  const media = new MediaRepository(dependencies.database);
  const read = readContentDraft(input.contentId, { content, media });
  if (read.status === "not-found") return { status: "not-found" };
  return {
    status: "restored",
    draft: read.draft,
    preview: dependencies.refreshPreview(),
  };
}

export function publicationHistory(
  contentId: string,
  database: Database
): PublishedRevision[] {
  return new PublicationRepository(database).listRevisions(contentId);
}
