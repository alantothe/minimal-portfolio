/**
 * The renderer, with the closed variant enum as the property under test.
 *
 * The interesting assertions are the refusals: an asset that is not `ready`, a
 * public ID trying to climb out of the account namespace, and a variant name
 * that did not come from the enum. Each of those would otherwise reach a
 * browser as a URL.
 */

import { describe, expect, test } from "bun:test";
import { renderMedia, variantDimensions } from "./delivery";
import { MEDIA_VARIANTS, isMediaVariant, type MediaVariant } from "./config";
import type { MediaAsset, MediaStatus } from "../database/mediaRepository";

const CLOUD = "example-cloud";

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    provider: "cloudinary",
    providerAssetId: "asset-abc",
    providerPublicId: "portfolio/11111111-2222-3333-4444-555555555555",
    providerVersion: "1700000000",
    format: "png",
    bytes: 4096,
    width: 2000,
    height: 1000,
    status: "ready",
    originalFilename: "photo.png",
    altText: null,
    digest: "d".repeat(64),
    createdAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("delivery URLs", () => {
  test("builds a versioned URL under the named transformation", () => {
    const rendered = renderMedia(asset(), "portfolio_card", CLOUD);

    expect(rendered?.url).toBe(
      "https://res.cloudinary.com/example-cloud/image/upload" +
        "/t_portfolio_card/v1700000000" +
        "/portfolio/11111111-2222-3333-4444-555555555555.png"
    );
  });

  test("emits only the named transformation, never raw parameters", () => {
    for (const variant of Object.keys(MEDIA_VARIANTS) as MediaVariant[]) {
      const rendered = renderMedia(asset(), variant, CLOUD);
      const transformation = new URL(rendered!.url).pathname.split("/")[4];

      // Under Strict Transformations anything beyond `t_<name>` is refused by
      // the provider, so a stray `f_auto` here would break delivery outright.
      expect(transformation).toBe(`t_${variant}`);
      expect(rendered!.url).not.toContain(",");
    }
  });

  test("the variant enum is closed against strings from outside", () => {
    // The values an attacker would want: transformation syntax, and a name that
    // is merely close to a real one.
    for (const candidate of [
      "w_9999",
      "c_fill,w_4000,h_4000",
      "portfolio_card/../../w_9000",
      "portfolio_banner",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isMediaVariant(candidate)).toBe(false);
    }

    for (const variant of Object.keys(MEDIA_VARIANTS)) {
      expect(isMediaVariant(variant)).toBe(true);
    }
  });

  test("inherited object properties do not pass the variant guard", () => {
    // `in` walks the prototype chain, so this is the one shape that could
    // smuggle a non-variant past a naive check.
    expect(isMediaVariant("toString")).toBe(false);
    expect(isMediaVariant("constructor")).toBe(false);
  });

  test("the renderer refuses a variant that bypassed the guard", () => {
    // Simulates a caller that forgot `isMediaVariant` — a variant read straight
    // out of the database or a form body. The answer must be "no image", never
    // a thrown error or a `t_undefined` URL.
    for (const smuggled of ["w_9999", "toString", "portfolio_banner", ""]) {
      expect(renderMedia(asset(), smuggled as MediaVariant, CLOUD)).toBeNull();
    }
  });

  test("refuses every status other than ready", () => {
    const statuses: MediaStatus[] = [
      "uploading",
      "tombstoned",
      "delete_pending",
      "deleted",
      "failed",
    ];

    for (const status of statuses) {
      expect(
        renderMedia(asset({ status }), "portfolio_card", CLOUD)
      ).toBeNull();
    }
  });

  test("refuses an asset missing provider metadata", () => {
    for (const missing of [
      { providerVersion: null },
      { format: null },
      { width: null },
      { height: null },
    ] as Partial<MediaAsset>[]) {
      expect(renderMedia(asset(missing), "portfolio_card", CLOUD)).toBeNull();
    }
  });

  test("refuses a public ID that would climb out of the account namespace", () => {
    for (const publicId of [
      "../secrets/key",
      "portfolio/../../other-cloud/asset",
      "portfolio//asset",
      "./asset",
    ]) {
      expect(
        renderMedia(
          asset({ providerPublicId: publicId }),
          "portfolio_card",
          CLOUD
        )
      ).toBeNull();
    }
  });

  test("escapes characters that would otherwise change how the URL parses", () => {
    const rendered = renderMedia(
      asset({ providerPublicId: "portfolio/a b?c#d" }),
      "portfolio_card",
      CLOUD
    );

    const url = new URL(rendered!.url);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(url.pathname).toContain("a%20b%3Fc%23d");
  });
});

describe("rendered dimensions", () => {
  test("a fill variant renders at the variant's box", () => {
    const rendered = renderMedia(asset(), "portfolio_avatar", CLOUD);
    expect(rendered).toMatchObject({ width: 800, height: 800 });
  });

  test("a limit variant scales down and keeps the aspect ratio", () => {
    expect(
      variantDimensions(MEDIA_VARIANTS.portfolio_wide, {
        width: 3200,
        height: 1600,
      })
    ).toEqual({ width: 1600, height: 800 });
  });

  test("a limit variant never upscales", () => {
    // Reporting 1600 here would reserve space the image cannot fill.
    expect(
      variantDimensions(MEDIA_VARIANTS.portfolio_wide, {
        width: 400,
        height: 300,
      })
    ).toEqual({ width: 400, height: 300 });
  });

  test("an extremely wide asset still gets a non-zero height", () => {
    expect(
      variantDimensions(MEDIA_VARIANTS.portfolio_wide, {
        width: 12_000,
        height: 3,
      }).height
    ).toBeGreaterThan(0);
  });
});
