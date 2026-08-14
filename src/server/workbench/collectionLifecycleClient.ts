/** Browser behaviour for collection creation and deletion. */

export const COLLECTION_LIFECYCLE_SCRIPT = `
(() => {
  const csrf = __CSRF__;
  const live = document.getElementById("workbench-status");
  const railStatus = document.getElementById("draft-status");

  function announce(visible, spoken = visible) {
    if (railStatus) railStatus.textContent = visible;
    if (!live) return;
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = spoken; });
  }

  const messages = {
    required: "Required to create this draft.",
    too_long: "Too long.",
    too_short: "Too short.",
    control_characters: "Contains unsupported control characters.",
    malformed_slug: "Use lowercase letters, numbers, and single hyphens.",
    reserved_slug: "This Public route is reserved.",
  };

  const createForm = document.getElementById("collection-create");
  if (createForm) {
    const title = createForm.elements.namedItem("title");
    const slug = createForm.elements.namedItem("slug");
    const submit = createForm.querySelector('[type="submit"]');
    const guidance = document.getElementById("creation-guidance");
    const summary = document.getElementById("creation-summary");

    function clearCreationFindings() {
      summary.hidden = true;
      summary.textContent = "";
      createForm.querySelectorAll("[data-create-field]").forEach((field) => {
        field.removeAttribute("aria-invalid");
      });
      createForm.querySelectorAll("[data-create-finding]").forEach((finding) => {
        finding.hidden = true;
        finding.textContent = "";
      });
    }

    function showCreationFindings(findings) {
      clearCreationFindings();
      const unplaced = [];
      findings.forEach((finding) => {
        const field = createForm.querySelector('[data-create-field="' + CSS.escape(finding.field) + '"]');
        const message = createForm.querySelector('[data-create-finding="' + CSS.escape(finding.field) + '"]');
        const text = messages[finding.code] || finding.code.replaceAll("_", " ");
        if (field && message) {
          field.setAttribute("aria-invalid", "true");
          message.textContent = text;
          message.hidden = false;
        } else {
          unplaced.push(text);
        }
      });
      if (unplaced.length) {
        summary.textContent = unplaced.join(" ");
        summary.hidden = false;
      }
    }

    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      clearCreationFindings();
      announce("Creating", "Creating Content draft");

      try {
        const response = await fetch("/admin/api/content", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          },
          body: JSON.stringify({
            type: createForm.dataset.contentType,
            title: title.value,
            slug: slug.value,
          }),
        });
        const body = await response.json();

        if (response.status === 422) {
          showCreationFindings(body.findings || []);
          announce("Needs attention", "Draft creation has validation errors");
          return;
        }
        if (!response.ok) {
          announce("Creation refused", "Content draft creation was refused");
          return;
        }
        if (body.status === "confirmation_required") {
          slug.value = body.suggestedSlug;
          guidance.textContent =
            body.reason === "collision"
              ? "That route is already reserved. Review this available suggestion, then choose Create again to confirm it."
              : "Review this generated route, then choose Create again to confirm it.";
          announce("Route confirmation required", "Review and confirm the suggested Public route");
          slug.focus();
          slug.select();
          return;
        }

        announce("Created", "Content draft created");
        const url = new URL("/admin", window.location.origin);
        url.searchParams.set("content", body.content.id);
        window.location.assign(url.toString());
      } catch {
        announce("Creation failed", "Content draft creation failed");
      } finally {
        submit.disabled = false;
      }
    });
  }

  const editor = document.getElementById("content-editor");
  const openDelete = document.getElementById("delete-content");
  const confirmDelete = document.getElementById("confirm-delete");
  const dialog = document.getElementById("delete-content-dialog");
  if (!editor || !openDelete || !confirmDelete || !dialog) return;

  openDelete.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => openDelete.focus());
  confirmDelete.addEventListener("click", async () => {
    confirmDelete.disabled = true;
    announce("Deleting", "Deleting collection draft");
    try {
      const response = await fetch(
        "/admin/api/content/" + encodeURIComponent(editor.dataset.contentId),
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          },
          body: JSON.stringify({ expectedUpdatedAt: editor.dataset.updatedAt }),
        }
      );
      const body = await response.json();
      if (response.status === 409) {
        dialog.close();
        announce("Conflict — reload required", "Content changed elsewhere. Reload before deleting.");
        return;
      }
      if (!response.ok) {
        announce("Deletion refused", "Collection draft deletion was refused");
        return;
      }

      document.dispatchEvent(new Event("content-deleted"));
      announce("Deleted", "Collection draft deleted");
      const url = new URL("/admin", window.location.origin);
      url.searchParams.set("preview", body.route);
      window.location.assign(url.toString());
    } catch {
      announce("Deletion failed", "Collection draft deletion failed");
    } finally {
      confirmDelete.disabled = false;
    }
  });
})();
`;
