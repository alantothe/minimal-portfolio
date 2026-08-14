import { describe, expect, test } from "bun:test";
import { COLLECTION_LIFECYCLE_SCRIPT } from "./collectionLifecycleClient";

function script(csrf = "csrf-token"): string {
  return COLLECTION_LIFECYCLE_SCRIPT.replace("__CSRF__", JSON.stringify(csrf));
}

describe("collection lifecycle browser script", () => {
  test("is valid JavaScript after the CSRF value is embedded", () => {
    expect(() => new Function(script())).not.toThrow();
  });

  test("requires an explicit second submit after filling a slug suggestion", () => {
    const source = script();

    expect(source).toContain('method: "POST"');
    expect(source).toContain('"X-CSRF-Token": csrf');
    expect(source).toContain('body.status === "confirmation_required"');
    expect(source).toContain("slug.value = body.suggestedSlug");
    expect(source).toContain("choose Create again to confirm it");
    expect(source).not.toContain("createForm.requestSubmit");
  });

  test("uses a native dialog and optimistic DELETE before returning to the collection", () => {
    const source = script();

    expect(source).toContain("dialog.showModal()");
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("expectedUpdatedAt: editor.dataset.updatedAt");
    expect(source).toContain("response.status === 409");
    expect(source).toContain('url.searchParams.set("preview", body.route)');
    expect(source).toContain('dialog.addEventListener("close"');
  });
});
