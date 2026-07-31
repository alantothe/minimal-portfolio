# Media storage and upload architecture

Research date: 2026-07-30
Scope: Owner-workspace image uploads for the Bun/Railway portfolio

## Decision

Use **Cloudinary Programmable Media** for V1 image storage, transformation, and CDN delivery. Send uploads through the authenticated Railway/Bun server, not directly from the browser.

Treat every uploaded file as an immutable `Media asset`:

- Generate a new local UUID and Cloudinary `public_id` for every upload.
- Set `overwrite=false`; replacing an image creates a second asset.
- Store Cloudinary's immutable `asset_id`, `public_id`, upload `version`, detected format, byte count, dimensions, and local lifecycle status in SQLite.
- Store only the local `media_asset_id` in Content drafts and Published revisions. Build delivery URLs at render time.
- Retain an asset while any current draft, current publication, or retained Published revision references it.
- Tombstone unused assets first; delete them from Cloudinary only after a 30-day quarantine and a second reference check.

This gives the application stable references, safe revision restoration, and a provider boundary that can later be migrated without rewriting every Content record.

## Why this wins for V1

Cloudinary combines storage, upload validation, transformations, CDN delivery, immutable provider IDs, deletion, and optional backup/version restoration in one managed service. Its Free plan currently includes 25 credits per month shared across transformations, storage, and bandwidth; one credit equals 1,000 transformations, 1 GB storage, or 1 GB image bandwidth. A small personal portfolio should usually remain inside that allowance, though usage must be monitored rather than assumed. [Cloudinary billing and plans](https://cloudinary.com/documentation/billing_and_plans)

Cloudinary is also the smallest change from this repository's current media path:

- [`src/server/services/markdown.ts`](../../src/server/services/markdown.ts) already converts `/images/{slug}/{name}` references into delivery URLs under the `dz18m79a1` Cloudinary cloud.
- [`src/content/projects/questurian/content.md`](../../src/content/projects/questurian/content.md) already stores a Cloudinary image URL.
- Local avatar, logo, and Open Graph files under [`src/public`](../../src/public) can remain deployment assets until migration work deliberately imports or preserves them.

V1 should replace the hard-coded cloud name and arbitrary URL persistence with configuration plus app-owned Media-asset references. It does not need a second media account, a new CDN integration, or an immediate rewrite of working legacy assets.

Cloudflare Images is similarly managed and has a stronger direct-upload primitive: its Direct Creator Upload API issues a one-time upload URL without exposing an API token. Hosted-image storage, however, requires the Images Paid plan: currently $5 per 100,000 stored images per month plus $1 per 100,000 delivered images. Its documented delete API deletes the image; the application would still need to implement all historical retention and delayed cleanup itself. [Cloudflare direct uploads](https://developers.cloudflare.com/images/storage/upload-images/direct-creator-upload/) [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/) [Cloudflare image deletion](https://developers.cloudflare.com/images/storage/manage-images/delete-images/)

R2 plus Cloudflare Images transformations is the lowest raw-infrastructure-cost path and the most flexible. It is not the lowest-operation path. Browser uploads need presigned S3 requests and CORS, production delivery needs a custom domain/cache configuration, and the application must implement trustworthy image decoding/validation, transformation integration, metadata, orphan reconciliation, and retention. Cloudflare itself describes R2 plus Images as the path for teams that want a custom image pipeline or fine-grained storage controls, while hosted Images is the least-configuration path. [Cloudflare Images storage choice](https://developers.cloudflare.com/images/get-started/introduction/) [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)

## Options compared

| Concern                      | Cloudinary                                                                                 | Cloudflare Images                                                               | Cloudflare R2 + Images                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| V1 upload                    | Authenticated server upload; browser never receives provider credentials                   | One-time direct browser upload URL                                              | Presigned `PutObject` URL or server upload                                                         |
| Provider-side image decoding | Yes; upload endpoint handles image assets and signed presets can restrict formats          | Yes; hosted Images accepts supported image formats and enforces platform limits | No complete managed ingestion pipeline; app must inspect uploaded object before publishing it      |
| Input limits                 | Account limits plus preset/app restrictions                                                | Hosted images: 10 MB, 100 MP, 12,000 px for most formats                        | General object limits; app defines image limits                                                    |
| Transform/CDN                | URL transformations, named transformations, automatic quality/format, CDN                  | Predefined/flexible variants, automatic modern formats, Cloudflare delivery     | Separate Images transformation setup; custom domain/cache required for production R2 delivery      |
| Stable identity              | Immutable `asset_id`; separate public delivery ID and upload version                       | Unique image ID in delivery URL                                                 | App-defined object key and metadata                                                                |
| Replacement                  | Provider supports overwrite/versioning, but V1 should create a new asset                   | Create a new image ID                                                           | Create a new object key                                                                            |
| Revision restore             | Retain immutable assets; optional Cloudinary backup can restore versions/deleted originals | Retain immutable image IDs; no documented historical-image restore workflow     | Retain unique keys; build own retention/backup rules                                               |
| Cleanup                      | Destroy by immutable asset ID; optional backup; CDN invalidation available                 | Delete by image ID                                                              | Delete object; purge CDN if required                                                               |
| Current entry cost           | Free plan: 25 shared credits/month                                                         | Hosted storage requires paid Images; $5/100k stored + $1/100k delivered         | R2 free allowance then $0.015/GB-month standard storage; Images transformation billing is separate |
| Operational burden           | Low                                                                                        | Lowest if recurring paid product is accepted                                    | Highest                                                                                            |

Sources for table facts:

- [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference)
- [Cloudinary transformations](https://cloudinary.com/documentation/image_transformations)
- [Cloudinary backups and version management](https://cloudinary.com/documentation/backups_and_version_management)
- [Cloudflare Images limits](https://developers.cloudflare.com/images/get-started/limits/)
- [Cloudflare hosted-image delivery](https://developers.cloudflare.com/images/optimization/hosted-images/serve-uploaded-images/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 cache configuration](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)

## Exact V1 architecture

### Components

```text
Owner browser
  |
  | POST multipart image
  | owner session + Origin + CSRF
  v
Bun /admin media route
  |-- request/body/type limits
  |-- SQLite upload intent
  |-- authenticated Cloudinary REST upload
  |-- provider-response validation
  v
Cloudinary original + named CDN variants
  ^
  | public image GET
Visitor browser

SQLite Content draft / Published revision
  -> local media_asset_id
  -> provider metadata in media_assets
  -> renderer builds approved delivery URL
```

The current server accepts only `GET`, `HEAD`, and `OPTIONS`, and routes using a `URL` rather than the full `Request`. Media work therefore depends on the already-identified request-routing redesign for authenticated mutation methods. Existing images under `src/public` remain deployment assets during migration; new owner uploads use the media service.

### Provider configuration

Create one dedicated production Cloudinary product environment. Configure:

1. A **signed** upload preset named `portfolio_owner_images`; do not create an unsigned preset.
2. `resource_type=image`.
3. Allowed source formats: JPEG, PNG, and WebP. Exclude SVG, GIF/animated inputs, PDF, and raw files from V1.
4. Maximum file size: 10 MB at provider level; enforce the same or a slightly smaller byte limit at the app edge.
5. `overwrite=false`.
6. Automatic backup enabled, if available for the selected account; understand that backed-up originals consume storage credits. Application retention remains the primary restore mechanism.
7. Strict Transformations enabled. Permit only the named transformations the application renders. Cloudinary documents this setting as protection against users generating arbitrary charged transformations. [Cloudinary strict transformations](https://cloudinary.com/documentation/control_access_to_media)
8. Named transformations fixed in config, not accepted from Content or query strings. Initial set:
   - `portfolio_avatar`: square fill, maximum 800×800.
   - `portfolio_card`: 5:3 fill, 600×360.
   - `portfolio_wide`: contain/limit, maximum width 1600, no upscaling.
9. Use automatic quality and browser-appropriate output format on approved delivery URLs. Cloudinary creates transformed derivatives on first access and caches them on its CDN. [Cloudinary transformations](https://cloudinary.com/documentation/image_transformations) [Cloudinary format optimization](https://cloudinary.com/documentation/image_format_support)

Exact dimensions can be revised by the Content-model ticket. The security rule is stable: renderer chooses from a closed variant enum; owners cannot type transformation syntax.

### Railway configuration

Add:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `MEDIA_PROVIDER=cloudinary`
- `MEDIA_MAX_UPLOAD_BYTES=10000000`

Seal `CLOUDINARY_API_SECRET` in Railway. Sealed variables are supplied to builds/deployments but are not visible in the UI or retrievable through the API. Never expose or log the secret. [Railway sealed variables](https://docs.railway.com/variables#sealed-variables)

Use a dedicated provider key/product environment for production. If Cloudinary account roles permit narrower key permissions, grant only required upload/read/delete operations. Do not reuse GitHub or application-session secrets.

### SQLite record

Minimum `media_assets` fields:

```text
id                    local UUID primary key
provider              "cloudinary"
provider_asset_id     immutable Cloudinary asset_id, unique
provider_public_id    random portfolio/<uuid>, unique
provider_version      upload version
format                provider-detected jpg/png/webp
bytes                 provider-reported bytes
width                 provider-reported width
height                provider-reported height
status                uploading|ready|tombstoned|delete_pending|deleted|failed
original_filename     display-only sanitized filename
alt_text              editable presentation metadata, if media library owns it
created_at
tombstoned_at
deleted_at
```

Keep alt text at the placement/reference layer if one image may need different descriptions in different contexts. Content-model work should make that final choice.

Never use original filenames as provider IDs. Never persist a Cloudinary URL inside Markdown or arbitrary HTML. Markdown image selection should insert an application media token/reference that resolves through `media_asset_id`.

Cloudinary returns an immutable, unique `asset_id`; use it for provider management and deletion. `public_id` participates in delivery URLs, while the upload `version` can bypass stale CDN content. [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference) [Cloudinary asset versions](https://cloudinary.com/documentation/image_transformations#asset_versions)

## Upload protocol

Expose one owner-only endpoint, for example:

```text
POST /api/admin/media
Content-Type: multipart/form-data
```

Sequence:

1. Require valid Owner session, exact allowed `Origin`, valid CSRF header, and expected multipart content type.
2. Reject absent/invalid `Content-Length`, chunked bodies over the configured limit, more than one file, empty files, and unexpected form fields.
3. Permit declared MIME types only for JPEG, PNG, and WebP. Treat extension and browser MIME as hints, not proof.
4. Check file signature/magic bytes before provider upload. Exclude SVG entirely in V1.
5. Generate local UUID and deterministic provider public ID `portfolio/<uuid>`. Insert `uploading` row.
6. Upload from Bun to Cloudinary's authenticated `image/upload` REST endpoint using HTTP Basic Authentication, which Cloudinary currently recommends for backend uploads. Send signed preset, deterministic `public_id`, `overwrite=false`, and application metadata containing the local UUID. Cloudinary says API secrets must never appear in client code. [Cloudinary Upload API authentication](https://cloudinary.com/documentation/image_upload_api_reference)
7. Apply a short connection timeout and bounded total timeout. Do not blindly retry an ambiguous upload. Query by deterministic `public_id`; `overwrite=false` makes reconciliation safe.
8. Validate response before marking ready:
   - HTTP success and expected Cloudinary response shape.
   - `resource_type=image`.
   - detected format is in the allowlist.
   - reported bytes do not exceed limit.
   - width and height are positive and below app limits.
   - `asset_id`, `public_id`, `version`, and secure delivery data exist.
9. Persist provider metadata and mark `ready` in one SQLite transaction.
10. On definite provider failure, mark `failed`. On DB failure after successful upload, attempt provider cleanup and retain a reconciliation record/log without secrets.
11. Return local asset ID, dimensions, and application-built preview URLs. Return neither provider credentials nor arbitrary transformation capability.

Apply owner-route rate limits despite single-user scope: one concurrent upload and a modest rolling request/byte cap prevent accidental loops and bound cost.

### Why server-mediated for V1

Cloudinary supports signature-based direct browser uploads, but signatures are valid for one hour and unsigned presets can be called by anyone who learns the preset name. Server mediation gives one enforcement point for owner auth, CSRF, byte limits, magic-byte checks, provider parameters, audit logs, and SQLite state. Files are capped at 10 MB, so the extra Railway hop is acceptable for a single-owner portfolio. [Cloudinary upload security](https://cloudinary.com/documentation/upload_images)

Revisit direct uploads only when upload size/volume makes Railway bandwidth or memory meaningful. If changed, issue short-lived signed parameters only after Owner auth and still require a server finalize step that verifies the provider asset before marking it ready.

## Delivery protocol

Public pages never receive Cloudinary credentials. Renderer maps:

```text
(media_asset_id, approved_variant)
  -> media_assets provider metadata
  -> HTTPS Cloudinary delivery URL
```

Use versioned delivery URLs and immutable public IDs. Set responsive `srcset`, explicit width/height, lazy loading below the fold, and useful alt text. Preserve original dimensions in SQLite to avoid layout shift.

Cloudinary delivery URLs include cloud name, transformation, version, public ID, and extension; transformed assets are generated and CDN-cached. Cloudinary supports automatic format selection based on browser support. [Cloudinary transformation URL structure](https://cloudinary.com/documentation/image_transformations) [Cloudinary automatic format](https://cloudinary.com/documentation/image_format_support)

Update Content Security Policy `img-src` for the exact Cloudinary delivery hostname. Do not allow arbitrary remote image URLs in owner-authored Content; imports from URLs are a separate future feature with SSRF rules.

## Replacement and revision restoration

“Replace image” means:

1. Upload a new immutable Media asset.
2. Update the current Content draft to reference the new local asset ID.
3. Leave the old asset untouched.
4. Publish creates a Published revision containing the new reference.

Restoring an older Published revision restores its old `media_asset_id`; no provider copy, overwrite, or CDN invalidation occurs. This is why provider overwrite must stay disabled even though Cloudinary supports overwriting a shared public ID.

Cloudinary can retain backed-up originals and restore prior or deleted versions when automatic backup is enabled. That is defense in depth, not normal revision behavior. Without backup, provider deletion may be permanent; backup must be explicitly enabled, and backup storage counts toward usage. [Cloudinary backups and version management](https://cloudinary.com/documentation/backups_and_version_management)

## Removal and garbage collection

Owner action “Remove from media library”:

1. Refuse if current draft or current Published content references asset, unless UI first replaces/removes those placements.
2. Set `status=tombstoned`; hide from normal picker.
3. Keep delivery working for every retained Published revision.

Daily or startup-safe GC:

1. Find tombstoned/failed assets older than 30 days.
2. Recompute references across drafts, current publications, all retained Published revisions, and migration records.
3. In transaction, mark unreferenced asset `delete_pending`.
4. Delete Cloudinary asset by immutable `asset_id`.
5. On success/not-found, mark `deleted`; on transient failure, return to retryable state with bounded backoff.
6. Keep metadata tombstone for audit/reconciliation; never reuse public ID.

Cloudinary supports deletion by immutable asset ID and warns that cached copies may remain temporarily unless invalidated. Unique immutable delivery URLs make immediate invalidation unnecessary for normal unreferenced cleanup; use invalidation for security/privacy incidents. [Cloudinary destroy API](https://cloudinary.com/documentation/image_upload_api_reference#destroy_by_asset_id)

Never run provider cleanup from “Publish,” “Restore revision,” or “Replace image.” Those paths only change references. Cleanup stays asynchronous and reference-counted.

## Failure and reconciliation rules

- Provider unavailable: upload fails cleanly; existing public content and media continue through CDN.
- SQLite unavailable: do not begin upload; fail closed.
- Upload succeeded but response lost: look up deterministic public ID, validate, then finalize; do not overwrite.
- Upload succeeded but DB finalization failed: cleanup or reconcile orphan.
- DB says ready but provider returns missing: mark incident; try Cloudinary backup restore if enabled; never silently publish broken image.
- Manual provider-console changes: nightly/startup audit samples or lists provider assets tagged with app UUID and compares with SQLite.
- Cost spike: Cloudinary dashboard alert plus strict transformations; halt new uploads before public delivery.
- Provider migration: add second `MediaProvider`, copy originals, update provider metadata behind unchanged local media IDs, then switch renderer.

## Verification checklist

Automated tests:

- Owner auth, Origin, and CSRF required for upload/remove.
- Visitor and expired Owner sessions cannot upload.
- Oversized, empty, multiple, spoofed MIME, SVG, animated GIF, and corrupt files rejected.
- Provider-reported format/dimensions/bytes validated.
- Upload public ID is unique and `overwrite=false`.
- Ambiguous upload reconciles without duplicate overwrite.
- Content stores local media ID, never raw provider URL.
- Variant input is closed enum; arbitrary transformation strings rejected.
- Replace creates new asset and leaves prior revisions renderable.
- Restore revision resolves old asset.
- Referenced/tombstoned assets are never deleted.
- Unreferenced asset waits 30 days and is rechecked before deletion.
- Provider delete retries are idempotent.
- Logs contain no API secret, Basic auth header, raw image bytes, or sensitive URL parameters.

Production smoke tests:

- Upload each allowed format from `/admin`.
- Preview draft and exact public rendering variants.
- Publish, replace, restore older revision, verify both asset URLs.
- Confirm CSP permits only intended image host.
- Confirm arbitrary Cloudinary transformation URL is blocked by Strict Transformations.
- Confirm Cloudinary backup setting and usage alert.
- Tombstone an unused test asset; run dry-run GC, then explicit test deletion.

## Reconsideration triggers

Choose Cloudflare Images instead when:

- paying its hosted-image minimum is acceptable,
- one-time direct browser upload URLs materially simplify desired UX,
- all stored media remains images,
- app-managed immutable retention is sufficient.

Choose R2 plus Images instead when:

- non-image files become in scope,
- storage/bandwidth volume makes Cloudinary credits expensive,
- custom-domain ownership and storage portability outweigh pipeline work,
- team accepts implementing post-upload decoding, quarantine, variants, cache rules, and backup/retention.

Re-evaluate Cloudinary before exceeding its Free-plan allowance, requiring a custom delivery hostname, or adding high-volume video. Capture actual 30-day storage, transformations, and bandwidth before migrating.

## Primary sources

- [Cloudinary Upload API Reference](https://cloudinary.com/documentation/image_upload_api_reference)
- [Cloudinary upload guide](https://cloudinary.com/documentation/upload_images)
- [Cloudinary upload presets](https://cloudinary.com/documentation/upload_presets)
- [Cloudinary image transformations](https://cloudinary.com/documentation/image_transformations)
- [Cloudinary strict transformations](https://cloudinary.com/documentation/control_access_to_media)
- [Cloudinary backups and version management](https://cloudinary.com/documentation/backups_and_version_management)
- [Cloudinary billing and plans](https://cloudinary.com/documentation/billing_and_plans)
- [Cloudflare Images introduction and storage choice](https://developers.cloudflare.com/images/get-started/introduction/)
- [Cloudflare Images Direct Creator Upload](https://developers.cloudflare.com/images/storage/upload-images/direct-creator-upload/)
- [Cloudflare Images limits and formats](https://developers.cloudflare.com/images/get-started/limits/)
- [Cloudflare Images delivery](https://developers.cloudflare.com/images/optimization/hosted-images/serve-uploaded-images/)
- [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Railway sealed variables](https://docs.railway.com/variables#sealed-variables)
