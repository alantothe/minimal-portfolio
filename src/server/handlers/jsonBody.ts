/** Shared bounded JSON-object parsing for authenticated API handlers. */

export type JsonObjectRead =
  | { ready: true; record: Record<string, unknown> }
  | { ready: false; response: Response };

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function readBoundedJsonObject(
  request: Request,
  options: { maxBytes: number; tooLargeError: string }
): Promise<JsonObjectRead> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    return {
      ready: false,
      response: jsonError(413, options.tooLargeError),
    };
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > options.maxBytes) {
    return {
      ready: false,
      response: jsonError(413, options.tooLargeError),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ready: false, response: jsonError(400, "invalid_json") };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ready: false, response: jsonError(400, "invalid_request") };
  }

  return { ready: true, record: body as Record<string, unknown> };
}
