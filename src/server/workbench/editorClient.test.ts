import { describe, expect, test } from "bun:test";
import { EDITOR_SCRIPT } from "./editorClient";

describe("singleton editor browser script", () => {
  test("is valid JavaScript after the CSRF value is embedded", () => {
    expect(
      () => new Function(EDITOR_SCRIPT.replace("__CSRF__", '"token"'))
    ).not.toThrow();
  });

  test("sends authenticated optimistic autosaves", () => {
    expect(EDITOR_SCRIPT).toContain('method: "PUT"');
    expect(EDITOR_SCRIPT).toContain('"X-CSRF-Token": csrf');
    expect(EDITOR_SCRIPT).toContain("expectedUpdatedAt");
    expect(EDITOR_SCRIPT).toContain("response.status === 409");
    expect(EDITOR_SCRIPT).toContain("form.dataset.publishFindings");
  });
});
