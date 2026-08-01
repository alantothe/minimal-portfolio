import { describe, expect, test } from "bun:test";
import { detectImageFormat } from "./imageSignature";

/** Builds a buffer starting with `signature`, padded to a plausible length. */
function file(signature: number[], length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(signature, 0);
  return bytes;
}

function ascii(text: string, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(
    [...text].map((character) => character.charCodeAt(0)),
    0
  );
  return bytes;
}

const JPEG = file([0xff, 0xd8, 0xff, 0xe0]);
const PNG = file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** RIFF....WEBP + a variant chunk, optionally with VP8X flags. */
function webp(chunk: string, flags = 0): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set(
    [..."RIFF"].map((c) => c.charCodeAt(0)),
    0
  );
  bytes.set(
    [..."WEBP"].map((c) => c.charCodeAt(0)),
    8
  );
  bytes.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12
  );
  bytes[20] = flags;
  return bytes;
}

describe("accepted formats", () => {
  test("detects a JPEG", () => {
    expect(detectImageFormat(JPEG)).toEqual({ status: "ok", format: "jpg" });
  });

  test("detects a PNG", () => {
    expect(detectImageFormat(PNG)).toEqual({ status: "ok", format: "png" });
  });

  test.each(["VP8 ", "VP8L"])("detects a still WebP (%p)", (chunk) => {
    expect(detectImageFormat(webp(chunk))).toEqual({
      status: "ok",
      format: "webp",
    });
  });

  test("accepts an extended WebP that is not animated", () => {
    expect(detectImageFormat(webp("VP8X", 0b0000_0000))).toEqual({
      status: "ok",
      format: "webp",
    });
  });
});

describe("refused content", () => {
  test("rejects an animated WebP", () => {
    expect(detectImageFormat(webp("VP8X", 0b0000_0010))).toEqual({
      status: "rejected",
      reason: "animated_images_not_supported",
    });
  });

  test.each([
    [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], "gif_not_supported"],
    [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "gif_not_supported"],
    [[0x25, 0x50, 0x44, 0x46], "pdf_not_supported"],
  ])("names the refusal for a known format", (signature, reason) => {
    expect(detectImageFormat(file(signature as number[]))).toEqual({
      status: "rejected",
      reason: reason as string,
    });
  });

  test.each([
    "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    "<?xml version='1.0'?><svg></svg>",
    "<!DOCTYPE svg><svg></svg>",
    "   <svg>",
  ])("rejects SVG however it opens: %p", (source) => {
    expect(detectImageFormat(ascii(source, 256))).toEqual({
      status: "rejected",
      reason: "svg_not_supported",
    });
  });

  test("rejects an empty file", () => {
    expect(detectImageFormat(new Uint8Array(0))).toEqual({
      status: "rejected",
      reason: "empty_file",
    });
  });

  test("rejects a file too short to identify", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({
      status: "rejected",
      reason: "truncated_file",
    });
  });

  test("rejects a RIFF container that is not WebP", () => {
    const wav = new Uint8Array(64);
    wav.set(
      [..."RIFF"].map((c) => c.charCodeAt(0)),
      0
    );
    wav.set(
      [..."WAVE"].map((c) => c.charCodeAt(0)),
      8
    );

    expect(detectImageFormat(wav).status).toBe("rejected");
  });

  test("rejects an unrecognised WebP variant", () => {
    expect(detectImageFormat(webp("XXXX"))).toEqual({
      status: "rejected",
      reason: "unrecognised_webp_variant",
    });
  });

  test("rejects arbitrary bytes", () => {
    expect(detectImageFormat(file([0x00, 0x01, 0x02, 0x03]))).toEqual({
      status: "rejected",
      reason: "unsupported_image_format",
    });
  });
});

describe("the declared type is a hint, never proof", () => {
  test("a PNG renamed and declared as JPEG is still detected as PNG", () => {
    expect(detectImageFormat(PNG)).toEqual({ status: "ok", format: "png" });
  });

  test("a mismatch between bytes and declared type is refused", () => {
    expect(detectImageFormat(PNG, "image/jpeg")).toEqual({
      status: "rejected",
      reason: "declared_type_mismatch",
    });
  });

  test("an executable declared as an image is refused on its bytes", () => {
    const elf = file([0x7f, 0x45, 0x4c, 0x46]);

    expect(detectImageFormat(elf, "image/png")).toEqual({
      status: "rejected",
      reason: "unsupported_image_format",
    });
  });

  test.each([
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("accepts %p for a matching %p", (declared, format) => {
    const bytes =
      format === "jpg" ? JPEG : format === "png" ? PNG : webp("VP8 ");

    expect(detectImageFormat(bytes, declared)).toEqual({
      status: "ok",
      format: format as "jpg" | "png" | "webp",
    });
  });

  test("tolerates parameters on the declared type", () => {
    expect(detectImageFormat(PNG, "image/png; charset=binary")).toEqual({
      status: "ok",
      format: "png",
    });
  });
});
