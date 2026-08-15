/** Authenticated JSON boundary for editable Content drafts. */

import type { RouteContext } from "../core/router";
import { getDatabase, isDatabaseAvailable } from "../database";
import { ContentRepository } from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { buildDraftPreviewSnapshot } from "../published/snapshot";
import {
  readContentDraft,
  saveContentDraft,
  type DraftDependencies,
} from "../workbench/contentDraft";
import { archiveCollectionDraft } from "../workbench/collectionLifecycle";
import { readBoundedJsonObject } from "./jsonBody";

const MAX_DRAFT_REQUEST_BYTES = 256 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dependencies(): DraftDependencies | null {
  if (!isDatabaseAvailable()) return null;
  const database = getDatabase();
  return {
    content: new ContentRepository(database),
    media: new MediaRepository(database),
    refreshPreview: () => {
      const build = buildDraftPreviewSnapshot(database);
      return build.status === "built"
        ? { status: "activated", generation: build.snapshot.generation }
        : { status: "rejected", findings: build.findings };
    },
  };
}

async function requestBody(request: Request): Promise<
  | {
      ready: true;
      data: unknown;
      attributes: Record<string, unknown> | undefined;
      expectedDraftVersion: number;
    }
  | { ready: false; response: Response }
> {
  const parsed = await readBoundedJsonObject(request, {
    maxBytes: MAX_DRAFT_REQUEST_BYTES,
    tooLargeError: "draft_too_large",
  });
  if (!parsed.ready) return parsed;
  const { record } = parsed;
  if (
    Object.keys(record).some(
      (key) =>
        key !== "data" && key !== "attributes" && key !== "expectedDraftVersion"
    ) ||
    !Number.isInteger(record.expectedDraftVersion) ||
    Number(record.expectedDraftVersion) < 1 ||
    !("data" in record)
  ) {
    return { ready: false, response: json(400, { error: "invalid_request" }) };
  }

  let attributes: Record<string, unknown> | undefined;
  if (record.attributes !== undefined) {
    if (
      typeof record.attributes !== "object" ||
      record.attributes === null ||
      Array.isArray(record.attributes)
    ) {
      return {
        ready: false,
        response: json(400, { error: "invalid_request" }),
      };
    }
    attributes = record.attributes as Record<string, unknown>;
    const allowed = new Set(["slug", "displayOrder", "publishedAt"]);
    if (
      Object.keys(attributes).some((key) => !allowed.has(key)) ||
      ("slug" in attributes && typeof attributes.slug !== "string") ||
      ("displayOrder" in attributes &&
        attributes.displayOrder !== null &&
        typeof attributes.displayOrder !== "number") ||
      ("publishedAt" in attributes &&
        attributes.publishedAt !== null &&
        typeof attributes.publishedAt !== "string")
    ) {
      return {
        ready: false,
        response: json(400, { error: "invalid_request" }),
      };
    }
  }

  return {
    ready: true,
    data: record.data,
    attributes,
    expectedDraftVersion: Number(record.expectedDraftVersion),
  };
}

async function deleteBody(
  request: Request
): Promise<
  | { ready: true; expectedUpdatedAt: string }
  | { ready: false; response: Response }
> {
  const parsed = await readBoundedJsonObject(request, {
    maxBytes: MAX_DRAFT_REQUEST_BYTES,
    tooLargeError: "draft_too_large",
  });
  if (!parsed.ready) return parsed;
  const { record } = parsed;
  if (
    Object.keys(record).some((key) => key !== "expectedUpdatedAt") ||
    typeof record.expectedUpdatedAt !== "string" ||
    record.expectedUpdatedAt === ""
  ) {
    return { ready: false, response: json(400, { error: "invalid_request" }) };
  }

  return { ready: true, expectedUpdatedAt: record.expectedUpdatedAt };
}

export async function contentDraftHandler({
  request,
  params,
}: RouteContext): Promise<Response> {
  const resolved = dependencies();
  if (!resolved) {
    return json(503, { error: "content_storage_unavailable" });
  }

  const id = params.id ?? "";
  if (request.method === "GET" || request.method === "HEAD") {
    const outcome = readContentDraft(id, resolved);
    return outcome.status === "found"
      ? json(200, { draft: outcome.draft })
      : json(404, { error: "content_not_found" });
  }

  if (request.method === "DELETE") {
    const body = await deleteBody(request);
    if (!body.ready) return body.response;
    const outcome = archiveCollectionDraft(
      { id, expectedUpdatedAt: body.expectedUpdatedAt },
      resolved
    );

    switch (outcome.status) {
      case "archived":
        return json(200, {
          status: "deleted",
          route: outcome.route,
          preview: outcome.preview,
        });
      case "not-deletable":
        return json(422, { error: "content_not_deletable" });
      case "conflict":
        return json(409, {
          error: "content_conflict",
          currentUpdatedAt: outcome.currentUpdatedAt,
        });
      case "not-found":
        return json(404, { error: "content_not_found" });
    }
  }

  const body = await requestBody(request);
  if (!body.ready) return body.response;

  const outcome = saveContentDraft(
    {
      id,
      data: body.data,
      attributes: body.attributes,
      expectedDraftVersion: body.expectedDraftVersion,
    },
    resolved
  );

  switch (outcome.status) {
    case "saved":
      return json(200, {
        draft: outcome.draft,
        preview: outcome.preview,
      });
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
    case "not-found":
      return json(404, { error: "content_not_found" });
  }
}
