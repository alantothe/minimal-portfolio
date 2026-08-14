/** Authenticated JSON boundary for singleton Content drafts. */

import type { RouteContext } from "../core/router";
import { getDatabase, isDatabaseAvailable } from "../database";
import { ContentRepository } from "../database/contentRepository";
import { MediaRepository } from "../database/mediaRepository";
import { buildDraftPreviewSnapshot } from "../published/snapshot";
import {
  readSingletonDraft,
  saveSingletonDraft,
  type DraftDependencies,
} from "../workbench/contentDraft";

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

async function requestBody(
  request: Request
): Promise<
  | { ready: true; data: unknown; expectedUpdatedAt: string }
  | { ready: false; response: Response }
> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_DRAFT_REQUEST_BYTES) {
    return { ready: false, response: json(413, { error: "draft_too_large" }) };
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_DRAFT_REQUEST_BYTES) {
    return { ready: false, response: json(413, { error: "draft_too_large" }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ready: false, response: json(400, { error: "invalid_json" }) };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ready: false, response: json(400, { error: "invalid_request" }) };
  }

  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "data" && key !== "expectedUpdatedAt"
    ) ||
    typeof record.expectedUpdatedAt !== "string" ||
    record.expectedUpdatedAt === "" ||
    !("data" in record)
  ) {
    return { ready: false, response: json(400, { error: "invalid_request" }) };
  }

  return {
    ready: true,
    data: record.data,
    expectedUpdatedAt: record.expectedUpdatedAt,
  };
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
    const outcome = readSingletonDraft(id, resolved.content);
    return outcome.status === "found"
      ? json(200, { draft: outcome.draft })
      : json(404, { error: "content_not_found" });
  }

  const body = await requestBody(request);
  if (!body.ready) return body.response;

  const outcome = saveSingletonDraft(
    {
      id,
      data: body.data,
      expectedUpdatedAt: body.expectedUpdatedAt,
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
        currentUpdatedAt: outcome.currentUpdatedAt,
      });
    case "not-found":
      return json(404, { error: "content_not_found" });
  }
}
