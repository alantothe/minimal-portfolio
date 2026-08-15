/** Authenticated HTTP boundary for publish, history, and restore. */

import type { RouteContext } from "../core/router";
import { getDatabase, isDatabaseAvailable } from "../database";
import { resolveOwnerSession } from "../auth/session";
import { buildDraftPreviewSnapshot } from "../published/snapshot";
import { getPublishedSite } from "../published/lifecycle";
import {
  publicationHistory,
  publishContent,
  restorePublishedRevision,
  type PublicationDependencies,
} from "../workbench/publication";
import { readBoundedJsonObject } from "./jsonBody";

const MAX_PUBLICATION_REQUEST_BYTES = 32 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function dependencies(): PublicationDependencies | null {
  if (!isDatabaseAvailable()) return null;
  const database = getDatabase();
  return {
    database,
    refreshPublished: () => getPublishedSite()?.refresh() ?? null,
    refreshPreview: () => {
      const build = buildDraftPreviewSnapshot(database);
      return build.status === "built"
        ? { status: "activated", generation: build.snapshot.generation }
        : { status: "rejected", findings: build.findings };
    },
  };
}

async function body(
  request: Request
): Promise<Record<string, unknown> | Response> {
  const parsed = await readBoundedJsonObject(request, {
    maxBytes: MAX_PUBLICATION_REQUEST_BYTES,
    tooLargeError: "publication_request_too_large",
  });
  return parsed.ready ? parsed.record : parsed.response;
}

function actor(request: Request): number | null {
  const session = resolveOwnerSession(request);
  return session.status === "active" ? session.session.githubUserId : null;
}

export async function publishHandler({
  request,
  params,
}: RouteContext): Promise<Response> {
  const resolved = dependencies();
  const githubUserId = actor(request);
  if (!resolved || githubUserId === null)
    return json(503, { error: "publication_unavailable" });
  const record = await body(request);
  if (record instanceof Response) return record;
  if (
    Object.keys(record).some(
      (key) => !["expectedDraftVersion", "idempotencyKey", "note"].includes(key)
    ) ||
    !Number.isInteger(record.expectedDraftVersion) ||
    Number(record.expectedDraftVersion) < 1 ||
    typeof record.idempotencyKey !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(record.idempotencyKey) ||
    (record.note !== undefined &&
      record.note !== null &&
      typeof record.note !== "string") ||
    (typeof record.note === "string" && record.note.length > 500)
  )
    return json(400, { error: "invalid_request" });

  const outcome = publishContent(
    {
      contentId: params.id ?? "",
      expectedDraftVersion: Number(record.expectedDraftVersion),
      idempotencyKey: record.idempotencyKey,
      actorGithubUserId: githubUserId,
      note: typeof record.note === "string" ? record.note : null,
    },
    resolved
  );
  switch (outcome.status) {
    case "published":
    case "replayed":
      return json(outcome.status === "published" ? 201 : 200, outcome);
    case "disabled":
      return json(409, { error: "publication_disabled_until_sealed" });
    case "invalid":
      return json(422, {
        error: "validation_failed",
        findings: outcome.findings,
      });
    case "conflict":
      return json(409, {
        error: "content_conflict",
        currentDraftVersion: outcome.currentDraftVersion,
      });
    case "idempotency-conflict":
      return json(409, { error: "idempotency_key_reused" });
    case "no-change":
      return json(409, {
        error: "no_changes_to_publish",
        revision: outcome.revision,
      });
    case "not-found":
      return json(404, { error: "content_not_found" });
  }
}

export async function historyHandler({
  params,
}: RouteContext): Promise<Response> {
  if (!isDatabaseAvailable())
    return json(503, { error: "publication_unavailable" });
  const revisions = publicationHistory(params.id ?? "", getDatabase());
  return json(200, {
    revisions: revisions.map((revision) => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      source: revision.source,
      publishedAt: revision.publishedAt,
      note: revision.note,
      restoredFromRevisionId: revision.restoredFromRevisionId,
    })),
  });
}

export async function restoreHandler({
  request,
  params,
}: RouteContext): Promise<Response> {
  const resolved = dependencies();
  const githubUserId = actor(request);
  if (!resolved || githubUserId === null)
    return json(503, { error: "publication_unavailable" });
  const record = await body(request);
  if (record instanceof Response) return record;
  if (
    Object.keys(record).some(
      (key) => !["revisionId", "expectedDraftVersion"].includes(key)
    ) ||
    typeof record.revisionId !== "string" ||
    record.revisionId === "" ||
    !Number.isInteger(record.expectedDraftVersion) ||
    Number(record.expectedDraftVersion) < 1
  )
    return json(400, { error: "invalid_request" });
  const outcome = restorePublishedRevision(
    {
      contentId: params.id ?? "",
      revisionId: record.revisionId,
      expectedDraftVersion: Number(record.expectedDraftVersion),
      actorGithubUserId: githubUserId,
    },
    resolved
  );
  return outcome.status === "restored"
    ? json(200, outcome)
    : outcome.status === "conflict"
      ? json(409, {
          error: "content_conflict",
          currentDraftVersion: outcome.currentDraftVersion,
        })
      : json(404, { error: "revision_not_found" });
}
