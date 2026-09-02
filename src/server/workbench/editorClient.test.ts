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
    expect(EDITOR_SCRIPT).toContain("expectedDraftVersion");
    expect(EDITOR_SCRIPT).toContain("response.status === 409");
    expect(EDITOR_SCRIPT).toContain("form.dataset.publishFindings");
    expect(EDITOR_SCRIPT).toContain('getElementById("draft-conflict-dialog")');
    expect(EDITOR_SCRIPT).toContain("navigator.clipboard.writeText");
    expect(EDITOR_SCRIPT).toContain('getElementById("reload-latest-draft")');
  });

  test("requires confirmation before editing a published Public route", () => {
    expect(EDITOR_SCRIPT).toContain('getElementById("change-url-dialog")');
    expect(EDITOR_SCRIPT).toContain('getElementById("confirm-change-url")');
    expect(EDITOR_SCRIPT).toContain("changeUrlDialog.showModal()");
    expect(EDITOR_SCRIPT).toContain("URL change pending");
  });

  test("serializes collection metadata and gallery ordering controls", () => {
    expect(EDITOR_SCRIPT).toContain('case "project"');
    expect(EDITOR_SCRIPT).toContain('case "blog_post"');
    expect(EDITOR_SCRIPT).toContain("displayOrder:");
    expect(EDITOR_SCRIPT).toContain("publishedAt:");
    expect(EDITOR_SCRIPT).toContain("attributes: attributes()");
    expect(EDITOR_SCRIPT).toContain('getElementById("project-gallery")');
    expect(EDITOR_SCRIPT).toContain('dataset.galleryAction === "up"');
    expect(EDITOR_SCRIPT).toContain('dataset.galleryAction === "down"');
    expect(EDITOR_SCRIPT).toContain("orderingChanged");
    expect(EDITOR_SCRIPT).toContain("workspaceUrl.searchParams.set(");
    expect(EDITOR_SCRIPT).toContain('"preview",');
    expect(EDITOR_SCRIPT).toContain(
      "window.location.assign(workspaceUrl.toString())"
    );
  });
});
