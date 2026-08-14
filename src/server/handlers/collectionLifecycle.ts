/** Authenticated JSON boundary for creating collection drafts. */

import type { RouteContext } from "../core/router";
import { isCollectionType } from "../content/identity";
import { getDatabase, isDatabaseAvailable } from "../database";
import { ContentRepository } from "../database/contentRepository";
import { buildDraftPreviewSnapshot } from "../published/snapshot";
import {
  createCollectionDraft,
  type CollectionLifecycleDependencies,
} from "../workbench/collectionLifecycle";
import { readBoundedJsonObject } from "./jsonBody";

const MAX_CREATE_REQUEST_BYTES = 8 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dependencies(): CollectionLifecycleDependencies | null {
  if (!isDatabaseAvailable()) return null;
  const database = getDatabase();
  return {
    content: new ContentRepository(database),
    refreshPreview: () => {
      const build = buildDraftPreviewSnapshot(database);
      return build.status === "built"
        ? { status: "activated", generation: build.snapshot.generation }
        : { status: "rejected", findings: build.findings };
    },
  };
}

async function createBody(
  request: Request
): Promise<
  | { ready: true; type: "project" | "blog_post"; title: string; slug?: string }
  | { ready: false; response: Response }
> {
  const parsed = await readBoundedJsonObject(request, {
    maxBytes: MAX_CREATE_REQUEST_BYTES,
    tooLargeError: "request_too_large",
  });
  if (!parsed.ready) return parsed;
  const { record } = parsed;
  if (
    Object.keys(record).some(
      (key) => key !== "type" && key !== "title" && key !== "slug"
    ) ||
    typeof record.type !== "string" ||
    !isCollectionType(record.type) ||
    typeof record.title !== "string" ||
    (record.slug !== undefined && typeof record.slug !== "string")
  ) {
    return { ready: false, response: json(400, { error: "invalid_request" }) };
  }

  return {
    ready: true,
    type: record.type,
    title: record.title,
    ...(record.slug === undefined ? {} : { slug: record.slug }),
  };
}

export async function collectionCreateHandler({
  request,
}: RouteContext): Promise<Response> {
  const resolved = dependencies();
  if (!resolved) {
    return json(503, { error: "content_storage_unavailable" });
  }

  const body = await createBody(request);
  if (!body.ready) return body.response;
  const outcome = createCollectionDraft(body, resolved);

  switch (outcome.status) {
    case "confirmation-required":
      return json(200, {
        status: "confirmation_required",
        suggestedSlug: outcome.suggestedSlug,
        reason: outcome.reason,
      });
    case "created":
      return json(201, {
        status: "created",
        content: {
          id: outcome.item.id,
          type: outcome.item.type,
          route: outcome.route,
        },
        preview: outcome.preview,
      });
    case "invalid":
      return json(422, {
        error: "validation_failed",
        findings: outcome.findings,
      });
  }
}
