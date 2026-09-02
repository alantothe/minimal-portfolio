/**
 * The image source policy.
 *
 * Owner-supplied images are about to start appearing in pages, so the browser
 * needs to be told where an image may legitimately come from. Without this, an
 * injected `<img>` can reach any host on the internet, which turns any future
 * content-rendering bug into an outbound request carrying the visitor's IP and
 * referrer.
 *
 * Scope is deliberately narrow. This covers images and Project video, without
 * changing script or style policy. Both directives are additive: existing
 * local assets and application-owned Cloudinary delivery remain permitted.
 *
 * What this does *not* do is pin the account. Cloudinary serves every customer
 * from one hostname and separates them by path, and CSP cannot express a path
 * constraint for images. Restricting delivery to *this* account's assets is
 * therefore the renderer's job — `delivery.ts` builds every URL from stored
 * provider metadata, and no code path lets a URL through from anywhere else.
 * The header is the outer fence, not the only one.
 */

import { DELIVERY_HOST } from "../media/config";

const IMAGE_SOURCES = ["'self'", `https://${DELIVERY_HOST}`] as const;
const VIDEO_SOURCES = ["'self'", `https://${DELIVERY_HOST}`] as const;

export const IMAGE_POLICY = `img-src ${IMAGE_SOURCES.join(" ")}; media-src ${VIDEO_SOURCES.join(" ")}`;

/**
 * Reports whether a source would be permitted, using the same list the header
 * is built from.
 *
 * This exists so the policy can be tested against the URLs the site actually
 * emits rather than by asserting on the header string, which would only prove
 * the constant matches itself.
 */
export function isAllowedImageSource(src: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(src, origin);
  } catch {
    return false;
  }

  if (url.origin === new URL(origin).origin) {
    return true;
  }

  return url.protocol === "https:" && url.hostname === DELIVERY_HOST;
}

export function isAllowedVideoSource(src: string, origin: string): boolean {
  return isAllowedImageSource(src, origin);
}

/**
 * Adds the policy to HTML responses.
 *
 * HTML only: the header governs what a *document* may load, and attaching it to
 * stylesheets, JSON, or images themselves would be noise. An existing
 * `Content-Security-Policy` is left alone so that a handler which sets a
 * stricter one — the Owner workspace, later — is not silently widened.
 */
export function applyImagePolicy(response: Response): Response {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (!contentType.includes("html")) {
    return response;
  }

  if (response.headers.has("Content-Security-Policy")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", IMAGE_POLICY);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
