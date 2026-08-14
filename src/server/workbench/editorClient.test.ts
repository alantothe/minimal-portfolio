import { describe, expect, test } from "bun:test";
import { EDITOR_SCRIPT } from "./editorClient";

describe("Content editor browser script", () => {
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

  test("serializes collection metadata and keyboard ordering controls", () => {
    expect(EDITOR_SCRIPT).toContain('case "project"');
    expect(EDITOR_SCRIPT).toContain('case "blog_post"');
    expect(EDITOR_SCRIPT).toContain("displayOrder:");
    expect(EDITOR_SCRIPT).toContain("publishedAt:");
    expect(EDITOR_SCRIPT).toContain("attributes: attributes()");
    expect(EDITOR_SCRIPT).toContain('getElementById("technologies")');
    expect(EDITOR_SCRIPT).toContain('dataset.listAction === "up"');
    expect(EDITOR_SCRIPT).toContain('dataset.listAction === "down"');
    expect(EDITOR_SCRIPT).toContain("orderingChanged");
    expect(EDITOR_SCRIPT).toContain("workspaceUrl.searchParams.set(");
    expect(EDITOR_SCRIPT).toContain('"preview",');
    expect(EDITOR_SCRIPT).toContain(
      "window.location.assign(workspaceUrl.toString())"
    );
  });
});
