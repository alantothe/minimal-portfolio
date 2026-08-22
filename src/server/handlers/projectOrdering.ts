/** Authenticated JSON boundary for changing Project display order. */

import type { RouteContext } from "../core/router";
import { getDatabase, isDatabaseAvailable } from "../database";
import { ContentRepository } from "../database/contentRepository";
import { buildDraftPreviewSnapshot } from "../published/snapshot";
import {
  moveProject,
  type ProjectMoveDirection,
  type ProjectOrderingDependencies,
} from "../workbench/projectOrdering";
import { readBoundedJsonObject } from "./jsonBody";

const MAX_ORDER_REQUEST_BYTES = 2 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dependencies(): ProjectOrderingDependencies | null {
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

async function requestBody(
  request: Request
): Promise<
  | { ready: true; id: string; direction: ProjectMoveDirection }
  | { ready: false; response: Response }
> {
  const parsed = await readBoundedJsonObject(request, {
    maxBytes: MAX_ORDER_REQUEST_BYTES,
    tooLargeError: "request_too_large",
  });
  if (!parsed.ready) return parsed;
  const { record } = parsed;
  if (
    Object.keys(record).some((key) => key !== "id" && key !== "direction") ||
    typeof record.id !== "string" ||
    record.id === "" ||
    (record.direction !== "up" && record.direction !== "down")
  ) {
    return { ready: false, response: json(400, { error: "invalid_request" }) };
  }

  return { ready: true, id: record.id, direction: record.direction };
}

export async function projectOrderingHandler({
  request,
}: RouteContext): Promise<Response> {
  const resolved = dependencies();
  if (!resolved) {
    return json(503, { error: "content_storage_unavailable" });
  }

  const body = await requestBody(request);
  if (!body.ready) return body.response;
  const outcome = moveProject(body, resolved);
  if (outcome.status === "not-found") {
    return json(404, { error: "project_not_found" });
  }
  if (outcome.status === "conflict") {
    return json(409, { error: "project_order_conflict" });
  }

  return json(200, outcome);
}
