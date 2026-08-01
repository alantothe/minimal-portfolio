/**
 * Downloading an image this application is about to take responsibility for.
 *
 * Exists for one asset and one reason. The Questurian project image lives on
 * cloud `dz18m79a1`, which the configured credentials cannot reach — `/ping`
 * against it answers `cloud_name mismatch` — so no Admin API call can ever
 * vouch for it. `legacyImport.ts` correctly refuses it as
 * `legacy_cloud_mismatch`, and that guard is not something to weaken.
 *
 * The way through is to stop asking the provider to prove identity and prove it
 * ourselves: fetch the bytes the public URL actually serves, hash them, and
 * store them under a public ID derived from that hash. The claim then becomes
 * "this record holds the image that URL served, and here is its digest", which
 * is a stronger statement than anything the old account could have told us.
 *
 * Fetching a URL out of content is otherwise a server-side request forgery
 * waiting to happen, so the guards here are the point of the module rather than
 * decoration: HTTPS only, one pinned hostname, no redirects, a byte cap
 * enforced while reading rather than after, and a timeout.
 */

import { DELIVERY_HOST } from "./config";

export type FetchImageOutcome =
  | { status: "ok"; bytes: Uint8Array; contentType: string | null }
  | { status: "rejected"; reason: string }
  | { status: "unavailable"; reason: string };

const REQUEST_TIMEOUT_MS = 30_000;

/** The only origin production ever fetches from. */
export const DELIVERY_ORIGIN = `https://${DELIVERY_HOST}`;

export interface FetchImageOptions {
  maxBytes: number;
  /**
   * Overridden only by this module's own tests, which point it at a loopback
   * server. Nothing in the application passes it.
   */
  allowedOrigin?: string;
}

export async function fetchDeliveredImage(
  url: string,
  options: FetchImageOptions
): Promise<FetchImageOutcome> {
  const allowedOrigin = options.allowedOrigin ?? DELIVERY_ORIGIN;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "rejected", reason: "invalid_url" };
  }

  // One equality check against the whole origin, rather than a scheme test and
  // a hostname test. It pins the port too, and it is the comparison that is
  // hardest to get subtly wrong: `https://res.cloudinary.com@evil.example/x`
  // has an origin of `https://evil.example`, and `res.cloudinary.com.evil.
  // example` is simply a different string. A `hostname.endsWith(...)` check
  // would have accepted both.
  if (parsed.origin !== allowedOrigin) {
    return { status: "rejected", reason: "origin_not_allowed" };
  }

  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      // A redirect is how a pinned hostname gets defeated: the check above
      // applies to the URL we asked for, and following a `Location` would let
      // the response come from somewhere else entirely.
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: "unavailable", reason: "legacy_asset_unreachable" };
  }

  if (response.status === 404 || response.status === 410) {
    return { status: "rejected", reason: "legacy_asset_not_found" };
  }

  if (!response.ok) {
    return { status: "unavailable", reason: "legacy_asset_unreachable" };
  }

  // A declared length over the cap is refused before reading anything. It is
  // advisory — the read below is what actually enforces the limit — but it
  // turns the common case into zero wasted bytes.
  const declared = response.headers.get("Content-Length");
  if (
    declared &&
    /^[0-9]+$/.test(declared) &&
    Number(declared) > options.maxBytes
  ) {
    return { status: "rejected", reason: "file_too_large" };
  }

  const body = response.body;
  if (!body) {
    return { status: "unavailable", reason: "legacy_asset_empty_response" };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;

      // Enforced mid-stream, not after. `response.arrayBuffer()` would buffer
      // the whole body before anyone could object, which makes the cap useless
      // against exactly the case it exists for.
      if (total > options.maxBytes) {
        await reader.cancel();
        return { status: "rejected", reason: "file_too_large" };
      }

      chunks.push(value);
    }
  } catch {
    return { status: "unavailable", reason: "legacy_asset_unreachable" };
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    return { status: "rejected", reason: "empty_file" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Returned but never trusted: the caller runs a magic-byte check, and this
  // header only exists so a mismatch can be reported as its own reason.
  return {
    status: "ok",
    bytes,
    contentType: response.headers.get("Content-Type"),
  };
}
