/**
 * Parsing what legacy content already says about its images.
 *
 * The real URL from Project frontmatter is the anchor case, because it is the
 * one the golden contract asserts on. The rest cover the ways a delivery URL can
 * be shaped and the ways a string can look like one without being one.
 */

import { describe, expect, test } from "bun:test";
import {
  classifyLegacyImage,
  legacyMarkdownImageUrl,
  parseCloudinaryDeliveryUrl,
} from "./legacy";

const QUESTURIAN =
  "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png";

describe("parsing legacy delivery URLs", () => {
  test("reads the asset out of the URL in Project frontmatter", () => {
    expect(parseCloudinaryDeliveryUrl(QUESTURIAN)).toEqual({
      kind: "cloudinary",
      cloudName: "dz18m79a1",
      publicId: "questura_rbayjx",
      version: "1761780791",
      format: "png",
    });
  });

  test("an underscore in the public ID is not read as a transformation", () => {
    // `questura_rbayjx` has an eight-letter prefix; transformation parameters
    // are one to three letters. Getting this wrong would silently truncate the
    // public ID and import the wrong asset.
    const parsed = parseCloudinaryDeliveryUrl(
      "https://res.cloudinary.com/cloud/image/upload/questura_rbayjx.png"
    );

    expect(parsed).toMatchObject({ publicId: "questura_rbayjx" });
  });

  test("handles URLs with no transformation and no version", () => {
    expect(
      parseCloudinaryDeliveryUrl(
        "https://res.cloudinary.com/cloud/image/upload/folder/name.webp"
      )
    ).toEqual({
      kind: "cloudinary",
      cloudName: "cloud",
      publicId: "folder/name",
      version: null,
      format: "webp",
    });
  });

  test("handles a public ID with no extension", () => {
    expect(
      parseCloudinaryDeliveryUrl(
        "https://res.cloudinary.com/cloud/image/upload/v123/name"
      )
    ).toMatchObject({ publicId: "name", version: "123", format: null });
  });

  test("a dot in a folder does not become an extension", () => {
    expect(
      parseCloudinaryDeliveryUrl(
        "https://res.cloudinary.com/cloud/image/upload/v1/site.com/logo"
      )
    ).toMatchObject({ publicId: "site.com/logo", format: null });
  });

  test("refuses anything that is not an https image-upload delivery URL", () => {
    for (const candidate of [
      "http://res.cloudinary.com/cloud/image/upload/v1/name.png",
      "https://res.cloudinary.com.evil.test/cloud/image/upload/v1/name.png",
      "https://evil.test/cloud/image/upload/v1/name.png",
      // Not `image/upload`: fetch proxies arbitrary remote URLs, and private
      // delivery is a different authorization model.
      "https://res.cloudinary.com/cloud/image/fetch/https://evil.test/x.png",
      "https://res.cloudinary.com/cloud/video/upload/v1/clip.mp4",
      "https://res.cloudinary.com/cloud/image/upload",
      "not a url",
      "",
    ]) {
      expect(parseCloudinaryDeliveryUrl(candidate).kind).toBe("foreign");
    }
  });

  test("refuses traversal in the public ID", () => {
    expect(
      parseCloudinaryDeliveryUrl(
        "https://res.cloudinary.com/cloud/image/upload/v1/..%2F..%2Fother/x.png"
      ).kind
    ).toBe("foreign");
  });
});

describe("classifying legacy images", () => {
  test("origin-relative paths are local", () => {
    for (const src of ["/avatar.webp", "/public/og.png", "/public/logo.png"]) {
      expect(classifyLegacyImage(src)).toEqual({ kind: "local", src });
    }
  });

  test("a protocol-relative URL is not mistaken for a local path", () => {
    expect(classifyLegacyImage("//evil.test/x.png").kind).toBe("foreign");
  });

  test("the frontmatter URL classifies as a Cloudinary asset", () => {
    expect(classifyLegacyImage(QUESTURIAN).kind).toBe("cloudinary");
  });
});

describe("the Markdown image shorthand", () => {
  test("expands to the same URL the service produced before", () => {
    // Frozen: published pages contain this string and the golden contract
    // asserts it does not move.
    expect(legacyMarkdownImageUrl("my-post", "diagram.png", "dz18m79a1")).toBe(
      "https://res.cloudinary.com/dz18m79a1/image/upload/my-post/diagram.png"
    );
  });

  test("round-trips back to the same public ID", () => {
    const url = legacyMarkdownImageUrl("my-post", "diagram.png", "cloud");
    expect(parseCloudinaryDeliveryUrl(url)).toMatchObject({
      publicId: "my-post/diagram",
      format: "png",
    });
  });
});
