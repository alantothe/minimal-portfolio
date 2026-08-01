/**
 * Accepting an image from the Owner.
 *
 * Authentication, same-origin, and CSRF are already settled before this runs —
 * `/admin/api/media` sits behind the boundary in `ownerBoundary.ts`, which
 * refuses an unauthenticated or cross-origin mutation before routing. This
 * module is therefore about the *file*, not the caller.
 *
 * The order of checks is the design. Everything that can be decided from cheap,
 * local evidence happens before a single byte is sent to the provider: content
 * type, declared length, field shape, actual size, then magic bytes. Only then
 * does the application spend a network round trip and a provider credit. An
 * upload path that validates after uploading has already paid for the attack.
 *
 * The database row is written before the provider call and completed after it,
 * so an interruption leaves a recoverable `uploading` row rather than an
 * anonymous orphan at the provider.
 */

import { createHash, randomUUID } from "node:crypto";
import { detectImageFormat } from "./imageSignature";
import { CONTENT_TYPE_FOR_FORMAT } from "./config";
import type { MediaConfig } from "./config";
import type { MediaProvider } from "./cloudinary";
import type { MediaAsset, MediaRepository } from "../database/mediaRepository";

export interface UploadDependencies {
  config: MediaConfig;
  repository: MediaRepository;
  provider: MediaProvider;
}

/** The form field the workspace posts the image in. */
const FILE_FIELD = "file";

/**
 * Structured events only. Image bytes, provider credentials, and the Basic auth
 * header are all forbidden from logs, so nothing derived from the request body
 * is interpolated here.
 */
function logEvent(event: string): void {
  console.log(`[media] ${event}`);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function refuse(status: number, reason: string): Response {
  logEvent(`upload_rejected:${reason}`);
  return json(status, { error: reason });
}

/**
 * Reads the single uploaded file, or explains what was wrong with the form.
 *
 * "Exactly one file and nothing else" is enforced rather than "at least one
 * file": an unexpected extra field is a sign the caller is not the workspace,
 * and quietly ignoring it would mean the server and the client disagree about
 * what was just sent.
 */
async function readSingleFile(
  request: Request
): Promise<{ file: File } | { error: string }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: "malformed_multipart_body" };
  }

  const entries = [...form.entries()];

  if (entries.length !== 1) {
    return {
      error:
        entries.length === 0 ? "no_file_supplied" : "unexpected_form_fields",
    };
  }

  const [name, value] = entries[0]!;

  if (name !== FILE_FIELD) {
    return { error: "unexpected_form_fields" };
  }

  if (typeof value === "string") {
    return { error: "no_file_supplied" };
  }

  return { file: value };
}

/** Display-only. Never used to build a provider ID or a filesystem path. */
function sanitizeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : null;
}

export async function handleMediaUpload(
  request: Request,
  dependencies: UploadDependencies
): Promise<Response> {
  const { config, repository, provider } = dependencies;

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return refuse(415, "expected_multipart_form_data");
  }

  // Checked before the body is read, so an oversized upload is refused without
  // being buffered into memory first.
  const declaredLength = request.headers.get("Content-Length");
  if (!declaredLength || !/^[0-9]+$/.test(declaredLength)) {
    return refuse(411, "content_length_required");
  }

  // The multipart envelope adds overhead, so this is a cheap upper bound rather
  // than the real limit; the exact byte count is checked after decoding.
  if (Number(declaredLength) > config.maxUploadBytes * 2) {
    return refuse(413, "file_too_large");
  }

  const parsed = await readSingleFile(request);
  if ("error" in parsed) {
    return refuse(400, parsed.error);
  }

  const bytes = new Uint8Array(await parsed.file.arrayBuffer());

  if (bytes.byteLength === 0) {
    return refuse(400, "empty_file");
  }

  if (bytes.byteLength > config.maxUploadBytes) {
    return refuse(413, "file_too_large");
  }

  const detected = detectImageFormat(bytes, parsed.file.type || null);
  if (detected.status === "rejected") {
    return refuse(415, detected.reason);
  }

  const id = randomUUID();
  // Derived from the local id, never from the filename: filenames collide, are
  // attacker-chosen, and leak information. Deterministic so that a lost
  // response can be reconciled by asking the provider about this exact ID.
  const providerPublicId = `portfolio/${id}`;
  const digest = createHash("sha256").update(bytes).digest("hex");

  let asset: MediaAsset;
  try {
    asset = repository.beginUpload({
      id,
      providerPublicId,
      originalFilename: sanitizeFilename(parsed.file.name ?? ""),
      digest,
    });
  } catch {
    // Fail closed: an upload the application cannot record is one it would not
    // be able to find, delete, or render later.
    return refuse(503, "media_storage_unavailable");
  }

  logEvent("upload_started");

  const uploaded = await provider.upload(
    bytes,
    providerPublicId,
    CONTENT_TYPE_FOR_FORMAT[detected.format]
  );

  if (uploaded.status === "rejected") {
    repository.markFailed(asset.id);
    return refuse(502, uploaded.reason);
  }

  // An ambiguous failure may still have stored the asset. Because the public ID
  // is deterministic and `overwrite=false`, asking is safe and answers
  // precisely; a blind retry would not.
  if (uploaded.status === "unavailable") {
    const reconciled = await provider.lookup(providerPublicId);

    if (reconciled.status === "found") {
      logEvent("upload_reconciled");
      const finalized = repository.finalizeUpload(
        asset.id,
        reconciled.metadata
      );

      if (finalized) {
        return json(201, describe(finalized));
      }
    }

    repository.markFailed(asset.id);
    return refuse(503, uploaded.reason);
  }

  const finalized = repository.finalizeUpload(asset.id, uploaded.metadata);

  if (!finalized) {
    // The provider holds an asset the application failed to record. Remove it
    // rather than leaving an orphan nobody will ever reference.
    await provider.destroy(providerPublicId, uploaded.metadata.providerAssetId);
    repository.markFailed(asset.id);
    return refuse(503, "media_storage_unavailable");
  }

  logEvent("upload_ready");
  return json(201, describe(finalized));
}

/**
 * What the workspace is told about an asset.
 *
 * Local id, dimensions, and format — enough to place the image and reserve
 * layout space. Deliberately not a delivery URL: rendering picks from a closed
 * set of variants, and handing the client a URL here would invite it to build
 * its own.
 */
function describe(asset: MediaAsset) {
  return {
    id: asset.id,
    format: asset.format,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    originalFilename: asset.originalFilename,
  };
}
