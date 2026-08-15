/** Conditional HTTP responses for the database-backed public cutover. */

import { createHash } from "node:crypto";

export interface PublishedResponseInput {
  body: BodyInit;
  contentType: string;
  etagSeed: string;
  status?: number;
}

export function publishedEtag(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("base64url");
  return `"${digest}"`;
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === etag;
  });
}

/**
 * Keeps mutable HTML/JSON revalidatable while making unchanged generations a
 * bodyless 304. This boundary remains off the Visitor route table until cutover.
 */
export function publishedResponse(
  request: Request,
  input: PublishedResponseInput
): Response {
  const status = input.status ?? 200;
  const etag = publishedEtag(input.etagSeed);
  const headers = {
    "Cache-Control": "no-cache",
    "Content-Type": input.contentType,
    ETag: etag,
  };
  const canRevalidate = request.method === "GET" || request.method === "HEAD";

  if (
    status === 200 &&
    canRevalidate &&
    matchesEtag(request.headers.get("If-None-Match"), etag)
  ) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === "HEAD" ? null : input.body, {
    status,
    headers,
  });
}
