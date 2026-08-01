/**
 * The serving mapping is pinned, and the importing one is pinned separately.
 *
 * The first group exists because `resolveStaticFilePath` was extracted from a
 * live handler: every one of these cases is a path the running site already
 * resolves, so a change here is a change to what visitors are served.
 */

import { describe, expect, test } from "bun:test";
import { resolveLocalAssetPath, resolveStaticFilePath } from "./staticPath";

describe("resolveStaticFilePath", () => {
  test("serves /public/ from src/public", () => {
    expect(resolveStaticFilePath("/public/og.png")).toBe("/src/public/og.png");
    expect(resolveStaticFilePath("/public/css/global.css")).toBe(
      "/src/public/css/global.css"
    );
  });

  test("serves /pages/ and /layout/ from their own directories", () => {
    expect(resolveStaticFilePath("/pages/blog/index.html")).toBe(
      "/src/pages/blog/index.html"
    );
    expect(resolveStaticFilePath("/layout/head.html")).toBe(
      "/src/layout/head.html"
    );
  });

  test("falls back to the public directory for a bare asset path", () => {
    // The doubled separator is what the handler has always produced. Asserted
    // rather than tidied: `Bun.file` does not care, and changing the string
    // would make this an edit to serving behaviour instead of an extraction.
    expect(resolveStaticFilePath("/avatar.webp")).toBe(
      "/src/public//avatar.webp"
    );
  });
});

describe("resolveLocalAssetPath", () => {
  test("accepts the three references the live site actually uses", () => {
    expect(resolveLocalAssetPath("/avatar.webp")).toEqual({
      status: "ok",
      path: "src/public/avatar.webp",
    });
    expect(resolveLocalAssetPath("/public/logo.png")).toEqual({
      status: "ok",
      path: "src/public/logo.png",
    });
    expect(resolveLocalAssetPath("/public/og.png")).toEqual({
      status: "ok",
      path: "src/public/og.png",
    });
  });

  test("refuses traversal out of the public directory", () => {
    for (const reference of [
      "/public/../../etc/passwd",
      "/public/../server/media/config.ts",
      "/../.env",
      "/public/./../../.env",
    ]) {
      expect(resolveLocalAssetPath(reference).status).toBe("rejected");
    }
  });

  test("refuses templates the server serves but the importer must not upload", () => {
    expect(resolveLocalAssetPath("/pages/blog/index.html")).toEqual({
      status: "rejected",
      reason: "outside_public_directory",
    });
    expect(resolveLocalAssetPath("/layout/head.html")).toEqual({
      status: "rejected",
      reason: "outside_public_directory",
    });
  });

  test("refuses references that are not local at all", () => {
    expect(resolveLocalAssetPath("https://example.com/a.png").status).toBe(
      "rejected"
    );
    // Protocol-relative: starts with a slash but names another host.
    expect(resolveLocalAssetPath("//evil.example/a.png")).toEqual({
      status: "rejected",
      reason: "not_a_local_reference",
    });
    expect(resolveLocalAssetPath("avatar.webp").status).toBe("rejected");
  });

  test("refuses query strings, fragments, and NUL bytes", () => {
    expect(resolveLocalAssetPath("/avatar.webp?v=2").status).toBe("rejected");
    expect(resolveLocalAssetPath("/avatar.webp#top").status).toBe("rejected");
    expect(resolveLocalAssetPath("/avatar.webp\0.txt").status).toBe("rejected");
  });

  test("refuses the public directory itself", () => {
    expect(resolveLocalAssetPath("/public/")).toEqual({
      status: "rejected",
      reason: "outside_public_directory",
    });
  });
});
