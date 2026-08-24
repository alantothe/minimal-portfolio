import { describe, expect, test } from "bun:test";
import { configurePreviewDocument } from "./preview";

const router =
  '<script src="/public/spa-router.js?v=next-cue-only" type="module"></script>';

describe("the exact public preview", () => {
  test("gives the public router the route hidden by the owner boundary", () => {
    const html = configurePreviewDocument(`<body>${router}</body>`, "/about");

    expect(html).toContain('globalThis.__PORTFOLIO_PREVIEW_ROUTE__="/about"');
    expect(html).toContain(router);
    expect(html.indexOf("__PORTFOLIO_PREVIEW_ROUTE__")).toBeLessThan(
      html.indexOf(router)
    );
  });

  test("script-looking routes cannot close the configuration element", () => {
    const html = configurePreviewDocument(
      `<body>${router}</body>`,
      "</script><script>alert(1)</script>"
    );

    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  test("fails loudly if the public document shape drifts", () => {
    expect(() => configurePreviewDocument("<body></body>", "/")).toThrow(
      "missing the SPA router script"
    );
  });
});
