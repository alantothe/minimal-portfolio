/**
 * The image policy, checked against what the site actually serves.
 *
 * Asserting the header string would only prove a constant equals itself. The
 * assertions that matter are that every image the pages emit today is still
 * permitted — the slice must stay invisible to visitors — and that the hosts an
 * injected `<img>` would reach are not.
 */

import { describe, expect, test } from "bun:test";
import {
  IMAGE_POLICY,
  applyImagePolicy,
  isAllowedImageSource,
} from "./securityHeaders";

const ORIGIN = "https://alanmalpartida.com";

function html(body = "<p>hi</p>", init: ResponseInit = {}): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html" },
    ...init,
  });
}

describe("the image policy", () => {
  test("permits every image the site serves today", () => {
    // The exact sources recorded in the golden contract.
    for (const src of [
      "/avatar.webp",
      "/public/logo.png",
      "/public/og.png",
      "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png",
    ]) {
      expect(isAllowedImageSource(src, ORIGIN)).toBe(true);
    }
  });

  test("permits the delivery host new uploads will use", () => {
    expect(
      isAllowedImageSource(
        "https://res.cloudinary.com/example-cloud/image/upload/t_portfolio_card/v1/portfolio/x.png",
        ORIGIN
      )
    ).toBe(true);
  });

  test("refuses hosts an injected image tag would reach", () => {
    for (const src of [
      "https://evil.test/pixel.png",
      // Look-alikes: a suffix match or a subdomain rule would let these through.
      "https://res.cloudinary.com.evil.test/pixel.png",
      "https://evil.res.cloudinary.com/pixel.png",
      // Plaintext leaks the referrer and is downgradeable.
      "http://res.cloudinary.com/cloud/image/upload/v1/x.png",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "//evil.test/pixel.png",
    ]) {
      expect(isAllowedImageSource(src, ORIGIN)).toBe(false);
    }
  });

  test("an unparseable source resolves against this origin and counts as self", () => {
    // Not a loophole: a relative reference is fetched from this origin, which
    // `'self'` permits and which serves no attacker-controlled bytes.
    expect(isAllowedImageSource("not a url", ORIGIN)).toBe(true);
  });

  test("names only img-src, so scripts and styles are untouched", () => {
    // A wider policy is a separate, riskier change; this slice must not make it
    // by accident.
    expect(IMAGE_POLICY).toBe("img-src 'self' https://res.cloudinary.com");
  });
});

describe("applying the policy", () => {
  test("adds the header to HTML", () => {
    expect(
      applyImagePolicy(html()).headers.get("Content-Security-Policy")
    ).toBe(IMAGE_POLICY);
  });

  test("preserves the body, status, and existing headers", async () => {
    const response = applyImagePolicy(
      new Response("<p>gone</p>", {
        status: 404,
        headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
      })
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response.text()).toBe("<p>gone</p>");
  });

  test("leaves non-HTML responses alone", () => {
    for (const contentType of [
      "application/json",
      "text/css",
      "image/png",
      "application/xml",
    ]) {
      const response = applyImagePolicy(
        new Response("x", { headers: { "Content-Type": contentType } })
      );
      expect(response.headers.has("Content-Security-Policy")).toBe(false);
    }
  });

  test("does not widen a policy a handler already set", () => {
    const strict = new Response("<p>admin</p>", {
      headers: {
        "Content-Type": "text/html",
        "Content-Security-Policy": "default-src 'none'",
      },
    });

    expect(
      applyImagePolicy(strict).headers.get("Content-Security-Policy")
    ).toBe("default-src 'none'");
  });
});
