/**
 * The Markdown image shorthand, pinned.
 *
 * The cloud name moved from a literal in this file to configuration. That is
 * only safe if the strings it produces are unchanged, so these tests assert the
 * exact URL rather than that "a Cloudinary URL" comes out.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { parseMarkdown } from "./markdown";

const original = process.env.MEDIA_LEGACY_CLOUD_NAME;

afterEach(() => {
  if (original === undefined) {
    delete process.env.MEDIA_LEGACY_CLOUD_NAME;
  } else {
    process.env.MEDIA_LEGACY_CLOUD_NAME = original;
  }
});

function post(body: string): string {
  return parseMarkdown(`---\ntitle: T\ndate: 2026-07-31\n---\n\n${body}\n`)
    .html;
}

describe("image shorthand expansion", () => {
  test("expands to exactly the URL the compiled-in cloud name produced", () => {
    delete process.env.MEDIA_LEGACY_CLOUD_NAME;

    expect(post('<img src="/images/my-post/diagram.png">')).toContain(
      'src="https://res.cloudinary.com/dz18m79a1/image/upload/my-post/diagram.png"'
    );
  });

  test("follows configuration when it is set", () => {
    process.env.MEDIA_LEGACY_CLOUD_NAME = "migrated-cloud";

    expect(post('<img src="/images/my-post/diagram.png">')).toContain(
      'src="https://res.cloudinary.com/migrated-cloud/image/upload/my-post/diagram.png"'
    );
  });

  test("leaves other image paths untouched", () => {
    delete process.env.MEDIA_LEGACY_CLOUD_NAME;

    // Only the `/images/{slug}/{name}` shape is rewritten; the site's own
    // assets and already-absolute URLs pass through.
    for (const src of [
      "/avatar.webp",
      "/public/og.png",
      "https://res.cloudinary.com/dz18m79a1/image/upload/v1761780791/questura_rbayjx.png",
    ]) {
      expect(post(`<img src="${src}">`)).toContain(`src="${src}"`);
    }
  });
});
