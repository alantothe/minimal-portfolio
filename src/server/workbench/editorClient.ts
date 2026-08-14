/** Browser autosave for schema-driven Content forms. */

export const EDITOR_SCRIPT = `
(() => {
  const form = document.getElementById("content-editor");
  if (!form) return;

  const csrf = __CSRF__;
  const status = document.getElementById("draft-status");
  const live = document.getElementById("workbench-status");
  const summary = document.getElementById("validation-summary");
  const preview = document.getElementById("preview-frame");
  let expectedUpdatedAt = form.dataset.updatedAt;
  let timer = null;
  let saving = false;
  let queued = false;
  let dirty = false;
  let conflicted = false;

  const value = (name) => form.elements.namedItem(name)?.value ?? "";
  const optional = (name) => value(name).trim() || null;
  const media = (name) => {
    const mediaAssetId = value(name + ".mediaAssetId");
    return mediaAssetId
      ? { mediaAssetId, alt: value(name + ".alt") }
      : null;
  };
  const seo = () => ({
    title: optional("seo.title"),
    description: optional("seo.description"),
    sharingImage: media("seo.sharingImage"),
  });

  function socialLinks() {
    return Array.from(form.querySelectorAll(".social-link-row"))
      .map((row, index) => {
        const labelInput = row.querySelector("[data-social-label]");
        const urlInput = row.querySelector("[data-social-url]");
        const labelFinding = row.querySelector("[data-social-label-finding]");
        const urlFinding = row.querySelector("[data-social-url-finding]");
        const label = labelInput.value;
        const url = urlInput.value;
        labelInput.dataset.field = "socialLinks[" + index + "].label";
        urlInput.dataset.field = "socialLinks[" + index + "].url";
        labelFinding.dataset.findingFor = "socialLinks[" + index + "].label";
        urlFinding.dataset.findingFor = "socialLinks[" + index + "].url";
        labelFinding.id = "finding-social-label-" + index;
        urlFinding.id = "finding-social-url-" + index;
        labelInput.setAttribute("aria-describedby", labelFinding.id);
        urlInput.setAttribute("aria-describedby", urlFinding.id);
        return { label, url };
      })
      .filter((link) => link.label.trim() || link.url.trim());
  }

  function technologies() {
    return Array.from(form.querySelectorAll(".technology-row"))
      .map((row, index) => {
        const input = row.querySelector("[data-technology]");
        const finding = row.querySelector("[data-technology-finding]");
        input.dataset.field = "technologies[" + index + "]";
        finding.dataset.findingFor = "technologies[" + index + "]";
        finding.id = "finding-technology-" + index;
        input.setAttribute("aria-describedby", finding.id);
        return input.value;
      })
      .filter((technology) => technology.trim());
  }

  function attributes() {
    switch (form.dataset.contentType) {
      case "project":
        return {
          slug: value("slug"),
          displayOrder: value("displayOrder") === "" ? null : Number(value("displayOrder")),
        };
      case "blog_post":
        return { slug: value("slug"), publishedAt: optional("publishedAt") };
      default:
        return undefined;
    }
  }

  function formData() {
    switch (form.dataset.contentType) {
      case "home":
        return {
          displayName: value("displayName"),
          email: value("email"),
          githubUsername: value("githubUsername"),
          professionalTitle: value("professionalTitle"),
          introMarkdown: value("introMarkdown"),
          bioMarkdown: value("bioMarkdown"),
          portrait: media("portrait"),
          seo: seo(),
        };
      case "about":
        return {
          introMarkdown: value("introMarkdown"),
          hobbiesMarkdown: value("hobbiesMarkdown"),
          socialLinks: socialLinks(),
          featuredTitle: value("featuredTitle"),
          featuredBodyMarkdown: value("featuredBodyMarkdown"),
          seo: seo(),
        };
      case "branding":
        return {
          logo: media("logo"),
          defaultSharingImage: media("defaultSharingImage"),
        };
      case "project":
        return {
          title: value("title"),
          summary: value("summary"),
          card: media("card"),
          kicker: value("kicker"),
          role: value("role"),
          status: value("status"),
          period: value("period"),
          technologies: technologies(),
          liveUrl: optional("liveUrl"),
          repositoryUrl: optional("repositoryUrl"),
          accentColor: value("accentColor"),
          bodyMarkdown: value("bodyMarkdown"),
          seo: seo(),
        };
      case "blog_post":
        return {
          title: value("title"),
          excerpt: value("excerpt"),
          bodyMarkdown: value("bodyMarkdown"),
          sharingImage: media("sharingImage"),
          seo: seo(),
        };
      default:
        throw new Error("Unsupported Content type");
    }
  }

  function setStatus(text, announcement = text) {
    status.textContent = text;
    live.textContent = "";
    requestAnimationFrame(() => {
      live.textContent = announcement;
    });
  }

  const messages = {
    required: "Required before publication.",
    too_long: "Too long.",
    too_short: "Too short.",
    control_characters: "Contains unsupported control characters.",
    invalid_email: "Enter a valid email address.",
    invalid_url: "Enter a valid HTTPS address.",
    malformed_url: "Enter a complete HTTPS address.",
    insecure_url: "Only HTTPS addresses are allowed.",
    unsafe_url: "This address is not allowed.",
    malformed_slug: "Use lowercase letters, numbers, and single hyphens.",
    reserved_slug: "This address is reserved.",
    duplicate_slug: "This address is already in use.",
    invalid_display_order: "Enter a whole number of zero or greater.",
    invalid_date: "Enter a real date in YYYY-MM-DD form.",
    future_publication_date: "Future publication dates are not scheduled.",
    invalid_accent_color: "Enter a six-digit colour such as #0b4fd4.",
    unknown_field: "Unknown field.",
    media_unavailable: "Choose an available Media asset.",
    alt_text_required: "Describe the image before publication.",
    raw_html_not_allowed: "Raw HTML is not allowed.",
    markdown_not_allowed: "This Markdown construct is not allowed.",
    expected_object: "This value has the wrong shape.",
    expected_array: "This value must be a list.",
    too_many: "Remove one or more entries.",
    longer_than_recommended: "Longer than recommended.",
    outside_recommended_length: "Outside recommended length.",
  };

  function clearFindings() {
    summary.innerHTML = "";
    summary.hidden = true;
    form.querySelectorAll("[data-field]").forEach((field) => {
      field.removeAttribute("aria-invalid");
    });
    form.querySelectorAll("[data-finding-for]").forEach((message) => {
      message.textContent = "";
      message.hidden = true;
    });
  }

  function showFindings(findings) {
    clearFindings();
    if (!findings?.length) return;
    const unplaced = [];

    findings.forEach((finding) => {
      let field = form.querySelector(
        '[data-field="' + CSS.escape(finding.field) + '"]'
      );
      if (!field) {
        field = form.querySelector(
          '[data-field^="' + CSS.escape(finding.field + ".") + '"]'
        );
      }
      const message = form.querySelector(
        '[data-finding-for="' + CSS.escape(finding.field) + '"]'
      );
      const text = messages[finding.code] || finding.code.replaceAll("_", " ");
      if (field && message) {
        if (finding.severity === "error") field.setAttribute("aria-invalid", "true");
        message.textContent = text;
        message.hidden = false;
      } else {
        unplaced.push(text);
      }
    });

    if (unplaced.length) {
      summary.innerHTML =
        "<strong>Check this draft</strong><ul>" +
        unplaced.map((message) => "<li>" + message + "</li>").join("") +
        "</ul>";
      summary.hidden = false;
    }
  }

  function refreshPreview(outcome) {
    if (!outcome || outcome.status === "rejected") return false;
    if (!preview) {
      window.location.reload();
      return true;
    }
    const url = new URL(preview.src);
    url.searchParams.set("draft", Date.now().toString());
    preview.src = url.toString();
    const generation = outcome.generation;
    const label = document.getElementById("preview-generation");
    if (label && generation) label.textContent = "ready · " + generation.slice(0, 8);
    return true;
  }

  async function save() {
    if (saving || conflicted) {
      queued = true;
      return;
    }
    saving = true;
    queued = false;
    setStatus("Saving", "Saving Content draft");

    try {
      const response = await fetch(
        "/admin/api/content/" + encodeURIComponent(form.dataset.contentId),
        {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          },
          body: JSON.stringify({
            data: formData(),
            attributes: attributes(),
            expectedUpdatedAt,
          }),
        }
      );
      const body = await response.json();

      if (response.status === 409) {
        conflicted = true;
        showFindings([]);
        setStatus(
          "Conflict — reload required",
          "Content changed elsewhere. Reload before saving again."
        );
        return;
      }
      if (response.status === 422) {
        dirty = true;
        showFindings(body.findings);
        setStatus("Needs attention", "Draft has validation errors");
        return;
      }
      if (!response.ok) {
        conflicted = true;
        setStatus("Save refused — reload required", "Draft save was refused");
        return;
      }

      expectedUpdatedAt = body.draft.updatedAt;
      dirty = false;
      showFindings(body.draft.publishFindings);
      const slugChanged =
        body.draft.slug !== null && body.draft.slug !== form.dataset.slug;
      const orderingChanged =
        (form.dataset.contentType === "project" &&
          String(body.draft.displayOrder ?? "") !== form.dataset.displayOrder) ||
        (form.dataset.contentType === "blog_post" &&
          (body.draft.publishedAt ?? "") !== form.dataset.publishedAt);
      if (slugChanged || orderingChanged) {
        const workspaceUrl = new URL(window.location.href);
        workspaceUrl.searchParams.set("content", form.dataset.contentId);
        if (orderingChanged) {
          workspaceUrl.searchParams.set(
            "preview",
            form.dataset.contentType === "project" ? "/projects" : "/blog"
          );
        } else {
          workspaceUrl.searchParams.delete("preview");
        }
        window.location.assign(workspaceUrl.toString());
        return;
      }
      const issueCount = body.draft.publishFindings.length;
      const previewUpdated = refreshPreview(body.preview);
      const details = [];
      if (issueCount) {
        details.push(
          issueCount + " publication issue" + (issueCount === 1 ? "" : "s")
        );
      }
      if (body.preview?.status === "rejected") {
        details.push("preview unavailable for this draft");
      }
      const suffix = details.length ? " · " + details.join(" · ") : "";
      setStatus("Saved" + suffix, previewUpdated ? "Draft saved and preview updated" : "Draft saved");
    } catch {
      dirty = true;
      setStatus("Save failed — retrying", "Draft save failed; retrying");
      window.setTimeout(save, 2000);
    } finally {
      saving = false;
      if (queued && !conflicted) save();
    }
  }

  function schedule() {
    if (conflicted) return;
    dirty = true;
    setStatus("Unsaved changes", "Content draft changed");
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 650);
  }

  form.addEventListener("input", schedule);
  form.addEventListener("change", schedule);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    save();
  });

  const links = document.getElementById("social-links");
  document.getElementById("add-social-link")?.addEventListener("click", () => {
    const template = document.getElementById("social-link-template");
    links.append(template.content.cloneNode(true));
    links.lastElementChild.querySelector("input").focus();
    schedule();
  });
  links?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-social-action]");
    if (!action) return;
    const row = action.closest(".social-link-row");
    if (action.dataset.socialAction === "remove") {
      row.remove();
    } else if (action.dataset.socialAction === "up") {
      const previous = row.previousElementSibling;
      if (previous) row.parentElement.insertBefore(row, previous);
    } else if (action.dataset.socialAction === "down") {
      const next = row.nextElementSibling;
      if (next) row.parentElement.insertBefore(next, row);
    }
    schedule();
  });

  const technologyList = document.getElementById("technologies");
  document.getElementById("add-technology")?.addEventListener("click", () => {
    const template = document.getElementById("technology-template");
    technologyList.append(template.content.cloneNode(true));
    technologyList.lastElementChild.querySelector("input").focus();
    schedule();
  });
  technologyList?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-list-action]");
    if (!action) return;
    const row = action.closest("[data-list-row]");
    if (action.dataset.listAction === "remove") {
      row.remove();
    } else if (action.dataset.listAction === "up") {
      const previous = row.previousElementSibling;
      if (previous) row.parentElement.insertBefore(row, previous);
    } else if (action.dataset.listAction === "down") {
      const next = row.nextElementSibling;
      if (next) row.parentElement.insertBefore(next, row);
    }
    schedule();
  });

  const initialFindings = JSON.parse(form.dataset.publishFindings || "[]");
  showFindings(initialFindings);
  if (initialFindings.length) {
    status.textContent =
      "Saved · " + initialFindings.length + " publication issue" +
      (initialFindings.length === 1 ? "" : "s");
  }

  window.addEventListener("beforeunload", (event) => {
    if (!dirty && !saving) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
`;
