/**
 * The Workbench document.
 *
 * #44 puts accessibility in scope rather than in a follow-up, and this module is
 * why that ordering is cheap: the landmark, heading, and focus structure is
 * decided once here, and every later pane inherits it by being rendered into a
 * region that already has a name and a place in the reading order.
 *
 * Two things are load-bearing and easy to undo by accident:
 *
 * 1. **The panes are readable without JavaScript.** Narrow and zoomed viewports
 *    get a stacked layout from CSS alone; the tab behaviour is an enhancement
 *    applied on top. A tabbed fallback that *needs* script would fail exactly
 *    the reflow case #36 §9 asks it to serve.
 * 2. **ARIA state is never asserted unless it is true.** The tablist is
 *    `display:none` in the wide layout, which removes it from the accessibility
 *    tree, and the tab roles are attached by script only while the narrow media
 *    query matches. Panes are never labelled as tabpanels while all three are
 *    visible at once.
 */

import type { LibrarySection } from "./library";
import type { SiteStatus } from "../published/site";
import { jsonForScript } from "./scriptValue";
import { escapeHtml } from "./html";
import { renderEditorPanel, type EditorPanel } from "./editor";
import { EDITOR_SCRIPT } from "./editorClient";
import { COLLECTION_LIFECYCLE_SCRIPT } from "./collectionLifecycleClient";

export { jsonForScript } from "./scriptValue";
export { escapeHtml } from "./html";

export type DraftStatus = "not-opened" | "saved" | "saving" | "invalid";

export interface WorkbenchView {
  /** The generation the preview is showing, or null when none exists. */
  generation: string | null;
  previewStatus: SiteStatus;
  draftStatus: DraftStatus;
  sections: LibrarySection[];
  selectedContentId: string;
  previewRoute: string;
  csrfToken: string;
  editor: EditorPanel;
  publishedRevision?: number | null;
}

/**
 * What the status rail says about the generation.
 *
 * Plain sentences rather than a status word alone. "degraded" tells an owner
 * nothing about whether their next edit is safe; the sentence does.
 */
function statusMessage(view: WorkbenchView): string {
  switch (view.previewStatus) {
    case "ready":
      return "Previewing the current Content draft as the public site.";
    case "degraded":
      return "Showing the last good draft preview. A newer one could not be built.";
    case "unavailable":
      return "No complete Content draft exists yet, so there is nothing to preview.";
  }
}

function draftStatusMessage(status: DraftStatus): string {
  switch (status) {
    case "not-opened":
      return "Not opened";
    case "saved":
      return "Saved";
    case "saving":
      return "Saving";
    case "invalid":
      return "Needs attention";
  }
}

function previewGenerationMessage(view: WorkbenchView): string {
  const generation = view.generation ? view.generation.slice(0, 8) : "none";
  return `${view.previewStatus} · ${generation}`;
}

/**
 * Contrast is a requirement, so the palette is written down rather than picked
 * per element. Every pairing below is at or above WCAG 2.2 AA for its size:
 * text on surface, muted on surface, and accent on surface all clear 4.5:1 in
 * both schemes.
 */
const STYLE = `
:root {
  color-scheme: light dark;
  --surface: #ffffff;
  --surface-sunken: #f4f5f7;
  --text: #17191d;
  --muted: #55585f;
  --border: #cfd2d8;
  --accent: #0b4fd4;
  --accent-contrast: #ffffff;
  --focus: #0b4fd4;
  --danger: #b42318;
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #14161a;
    --surface-sunken: #1c1f25;
    --text: #f2f3f5;
    --muted: #aeb3bc;
    --border: #333842;
    --accent: #8fb4ff;
    --accent-contrast: #0d0f13;
    --focus: #8fb4ff;
    --danger: #ff9b8f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--surface);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 0.95rem;
  line-height: 1.5;
}
:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  background: var(--accent);
  color: var(--accent-contrast);
  padding: 0.6rem 1rem;
  z-index: 10;
}
.skip-link:focus {
  left: 0;
}
.rail {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: baseline;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface-sunken);
}
.rail h1 { font-size: 1rem; margin: 0; }
.rail p { margin: 0; color: var(--muted); font-size: 0.85rem; }
.rail dl { display: flex; gap: 1rem; margin: 0; font-size: 0.8rem; }
.rail dt { color: var(--muted); }
.rail dd { margin: 0 0 0 0.25rem; font-variant-numeric: tabular-nums; }
.rail > div:last-child { display: flex; gap: 1rem; align-items: baseline; }
.rail dl > div { display: flex; }
/*
 * Available to assistive technology, absent from the visual layout. Not
 * \`display:none\`, which would remove it from the accessibility tree and stop
 * the live region announcing anything at all.
 */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
button, .button {
  font: inherit;
  padding: 0.4rem 0.85rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
button:disabled { cursor: not-allowed; opacity: 0.55; }
.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
}
.workbench {
  display: grid;
  grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 1px;
  background: var(--border);
  min-height: calc(100vh - 4.5rem);
}
.pane {
  background: var(--surface);
  padding: 1rem;
  overflow: auto;
}
.pane > h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 0.75rem; }
.pane h3 { font-size: 0.85rem; margin: 1rem 0 0.4rem; }
.pane h3:first-of-type { margin-top: 0; }
.library ul { list-style: none; margin: 0; padding: 0; }
.library li { margin: 0 0 0.15rem; }
.library li.project-order-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem;
  align-items: center;
}
.library a {
  display: block;
  padding: 0.4rem 0.5rem;
  border-radius: 0.3rem;
  color: inherit;
  text-decoration: none;
  border: 1px solid transparent;
}
.library a:hover { background: var(--surface-sunken); }
.library a[aria-current="true"] {
  background: var(--surface-sunken);
  border-color: var(--border);
  font-weight: 600;
}
.library .detail { display: block; color: var(--muted); font-size: 0.8rem; }
.library p.empty { color: var(--muted); margin: 0; }
.library-order-actions { display: flex; gap: 0.15rem; }
.library-order-actions button {
  width: 1.8rem;
  min-height: 1.8rem;
  padding: 0;
  line-height: 1;
}
.library-order-note { color: var(--muted); font-size: 0.76rem; margin: 0.35rem 0 0; }
.library-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 1rem;
}
.library-section-heading:first-of-type { margin-top: 0; }
.library-section-heading h3 { margin: 0; }
.library-section-heading .button { padding: 0.2rem 0.5rem; font-size: 0.78rem; text-decoration: none; }
.editor-intro {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.editor-intro h3, .empty-editor h3 { margin: 0; font-size: 1.2rem; }
.editor-intro p:last-child { max-width: 27rem; margin: 0; color: var(--muted); }
.eyebrow {
  margin: 0 0 0.15rem;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
fieldset {
  min-width: 0;
  margin: 1.25rem 0 0;
  padding: 0;
  border: 0;
}
legend {
  width: 100%;
  padding: 0 0 0.35rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.field { display: grid; gap: 0.25rem; margin-top: 0.85rem; }
.field-label { display: block; font-weight: 650; }
.field-hint, .fieldset-note { color: var(--muted); font-size: 0.8rem; }
.fieldset-note { margin: 0.75rem 0 0; }
input, textarea, select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.3rem;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  padding: 0.5rem 0.6rem;
}
textarea { min-height: 7rem; resize: vertical; }
[aria-invalid="true"] { border-color: #b42318; }
.field-finding { margin: 0; color: var(--danger); font-size: 0.8rem; }
.media-field {
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: var(--surface-sunken);
}
.media-upload {
  margin: 0.85rem 0;
  padding: 0.85rem;
  border: 1px dashed var(--line);
  border-radius: 0.55rem;
}
.media-upload input[type="file"] { display: block; margin-top: 0.45rem; max-width: 100%; }
.media-upload button { margin-top: 0.65rem; }
.media-upload-status { display: inline-block; margin-left: 0.55rem; color: var(--muted); font-size: 0.78rem; }
.media-field label + .field-finding + label { display: block; margin-top: 0.7rem; }
.social-link-row, .technology-row {
  display: grid;
  grid-template-columns: minmax(7rem, 0.7fr) minmax(10rem, 1.3fr) auto;
  align-items: end;
  gap: 0.5rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border);
}
.technology-row { grid-template-columns: minmax(10rem, 1fr) auto; }
.social-link-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.social-link-actions button { padding-inline: 0.55rem; }
.list-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.list-actions button { padding-inline: 0.55rem; }
.quiet { margin-top: 0.65rem; }
.editor-actions {
  position: sticky;
  bottom: -1rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin: 1.5rem -1rem -1rem;
  padding: 0.8rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.editor-actions span { color: var(--muted); font-size: 0.78rem; }
.danger { border-color: var(--danger); color: var(--danger); }
dialog {
  width: min(30rem, calc(100% - 2rem));
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--text);
  padding: 1.25rem;
}
dialog::backdrop { background: rgb(0 0 0 / 0.55); }
dialog h3 { margin: 0; font-size: 1.1rem; }
dialog p { color: var(--muted); }
.dialog-actions { display: flex; justify-content: end; gap: 0.5rem; }
.validation-summary {
  margin-top: 1rem;
  padding: 0.75rem;
  border-left: 3px solid #b42318;
  background: var(--surface-sunken);
}
.validation-summary ul { margin: 0.35rem 0 0; padding-left: 1.2rem; }
.empty-editor { max-width: 30rem; padding: 1rem 0; }
.empty-editor p:last-child { color: var(--muted); }
.preview-frame {
  width: 100%;
  height: 100%;
  min-height: 30rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: var(--surface);
}
.note { color: var(--muted); }
.tabs { display: none; }

/*
 * Reflow. Below this width — which a 400% zoom of a normal window also
 * produces — the three panes stack and every one of them stays reachable by
 * scrolling. Script upgrades this to tabs; without script it is still usable,
 * which is the point.
 */
@media (max-width: 60rem) {
  .workbench { grid-template-columns: minmax(0, 1fr); }
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 1rem 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface-sunken);
  }
  .tabs [role="tab"] {
    border-radius: 0.35rem 0.35rem 0 0;
    border-bottom-color: transparent;
  }
  .tabs [role="tab"][aria-selected="true"] {
    background: var(--surface);
    font-weight: 600;
  }
}
@media (max-width: 35rem) {
  .rail dl, .editor-intro { display: block; }
  .rail dl > div { margin-top: 0.2rem; }
  .social-link-row, .technology-row { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .editor-actions { flex-wrap: wrap; }
}
`;

const SCRIPT = `
(() => {
  const csrf = __CSRF__;

  const signOut = document.getElementById("signout");
  signOut.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch("/admin/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      credentials: "same-origin",
    });
    window.location.href = response.redirected ? response.url : "/admin/login";
  });

  // Reflow to tabs. The roles are applied only while the narrow layout is the
  // one on screen, so a screen reader is never told there are tabs while all
  // three panes are visible side by side.
  const narrow = window.matchMedia("(max-width: 60rem)");
  const tablist = document.querySelector(".tabs");
  const tabs = Array.from(tablist.querySelectorAll("button"));
  const panes = tabs.map((tab) => document.getElementById(tab.dataset.pane));

  function select(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      // Roving tabindex: one stop for the group, arrow keys move within it.
      tab.tabIndex = i === index ? 0 : -1;
      panes[i].hidden = i !== index;
    });
  }

  function apply() {
    if (narrow.matches) {
      tablist.setAttribute("role", "tablist");
      tabs.forEach((tab, i) => {
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", panes[i].id);
        panes[i].setAttribute("role", "tabpanel");
        panes[i].setAttribute("aria-labelledby", tab.id);
      });
      select(tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true") || 0);
    } else {
      tablist.removeAttribute("role");
      tabs.forEach((tab, i) => {
        tab.removeAttribute("role");
        tab.removeAttribute("aria-controls");
        tab.tabIndex = 0;
        panes[i].removeAttribute("role");
        panes[i].removeAttribute("aria-labelledby");
        panes[i].hidden = false;
      });
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = (index + step + tabs.length) % tabs.length;
      select(next);
      tabs[next].focus();
    });
  });

  let reorderingProject = false;
  document.getElementById("library").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-project-order]");
    if (!button || reorderingProject) return;
    reorderingProject = true;
    const orderButtons = Array.from(document.querySelectorAll("[data-project-order]"));
    orderButtons.forEach((candidate) => { candidate.disabled = true; });
    const status = document.getElementById("workbench-status");
    status.textContent = "Saving Project order";

    try {
      const response = await fetch("/admin/api/projects/order", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify({
          id: button.dataset.projectId,
          direction: button.dataset.projectOrder,
        }),
      });
      if (!response.ok) throw new Error("Project order was refused");

      const workspaceUrl = new URL(window.location.href);
      workspaceUrl.searchParams.delete("new");
      workspaceUrl.searchParams.set("preview", "/projects");
      window.location.assign(workspaceUrl.toString());
    } catch {
      reorderingProject = false;
      orderButtons.forEach((candidate) => {
        candidate.disabled = candidate.dataset.orderBoundary === "true";
      });
      status.textContent = "Project order could not be saved. Try again.";
    }
  });

  narrow.addEventListener("change", apply);
  apply();
})();
`;

function librarySection(
  section: LibrarySection,
  selectedContentId: string
): string {
  const addLabel =
    section.collectionType === "project" ? "Add Project" : "Add Blog post";
  const addControl = section.collectionType
    ? `<a class="button" href="/admin?new=${encodeURIComponent(section.collectionType)}">${addLabel}</a>`
    : "";
  const heading = `<div class="library-section-heading"><h3 id="lib-${escapeHtml(section.id)}">${escapeHtml(section.label)}</h3>${addControl}</div>`;

  if (section.entries.length === 0) {
    return `${heading}\n<p class="empty">Nothing here yet.</p>`;
  }

  const items = section.entries
    .map((entry, index) => {
      // `aria-current` marks the Content item the editor is focused on. It is the
      // property that tells a screen reader which of a set of links is the one
      // you are on, which a visual highlight alone does not.
      const isCurrent = entry.id === selectedContentId;
      const supportingText = entry.supportingText
        ? `<span class="detail">${escapeHtml(entry.supportingText)}</span>`
        : "";

      const orderControls =
        section.collectionType === "project" && section.entries.length > 1
          ? `<span class="library-order-actions">
        <button type="button" data-project-order="up" data-project-id="${escapeHtml(entry.id)}" data-order-boundary="${index === 0}" aria-label="Move ${escapeHtml(entry.label)} up" title="Move up"${index === 0 ? " disabled" : ""}>&uarr;</button>
        <button type="button" data-project-order="down" data-project-id="${escapeHtml(entry.id)}" data-order-boundary="${index === section.entries.length - 1}" aria-label="Move ${escapeHtml(entry.label)} down" title="Move down"${index === section.entries.length - 1 ? " disabled" : ""}>&darr;</button>
      </span>`
          : "";
      const itemClass = orderControls ? ' class="project-order-item"' : "";

      return `<li${itemClass}><a href="/admin?content=${encodeURIComponent(entry.id)}"${
        isCurrent ? ' aria-current="true"' : ""
      }>${escapeHtml(entry.label)}${supportingText}</a>${orderControls}</li>`;
    })
    .join("\n");

  const orderNote =
    section.collectionType === "project" && section.entries.length > 1
      ? '<p class="library-order-note">Use arrows to reorder the Project drafts. Publish affected Projects when ready.</p>'
      : "";

  return `${heading}\n<ul aria-labelledby="lib-${escapeHtml(section.id)}">\n${items}\n</ul>${orderNote}`;
}

export function renderWorkbench(view: WorkbenchView): string {
  const message = statusMessage(view);
  const previewable = view.previewStatus !== "unavailable";

  const sections = view.sections
    .map((section) => librarySection(section, view.selectedContentId))
    .join("\n");

  const preview = previewable
    ? `<iframe
    class="preview-frame"
    id="preview-frame"
    title="Public preview of ${escapeHtml(view.previewRoute)}"
    src="/admin/preview?route=${encodeURIComponent(view.previewRoute)}"
    loading="lazy"></iframe>`
    : `<p class="note">${escapeHtml(message)}</p>`;
  const editor = renderEditorPanel(view.editor);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Workbench — Owner workspace</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip-link" href="#editor">Skip to editor</a>

<header class="rail">
  <div>
    <h1>Workbench</h1>
    <p>${escapeHtml(message)}</p>
  </div>
  <div>
    <dl>
      <div><dt>Content draft</dt><dd id="draft-status">${escapeHtml(draftStatusMessage(view.draftStatus))}</dd></div>
      <div><dt>Published revision</dt><dd>${view.publishedRevision ? `Revision ${view.publishedRevision}` : "None yet"}</dd></div>
      <div><dt>Preview generation</dt><dd id="preview-generation">${escapeHtml(previewGenerationMessage(view))}</dd></div>
    </dl>
    <form method="post" action="/admin/logout" id="signout">
      <button type="submit">Sign out</button>
    </form>
  </div>
</header>

<!--
  Announcements land here. It is polite and it is the only live region on the
  page: #36 §9 asks for restrained announcements, and several competing live
  regions is how that requirement gets broken without anyone noticing.
-->
<p id="workbench-status" role="status" aria-live="polite" class="visually-hidden"></p>

<div class="tabs">
  <button type="button" id="tab-library" data-pane="library" aria-selected="true">Library</button>
  <button type="button" id="tab-editor" data-pane="editor" aria-selected="false">Editor</button>
  <button type="button" id="tab-preview" data-pane="preview" aria-selected="false">Preview</button>
</div>

<div class="workbench">
  <nav class="pane library" id="library" aria-labelledby="library-heading">
    <h2 id="library-heading">Content library</h2>
    ${sections}
  </nav>

  <main class="pane" id="editor" aria-labelledby="editor-heading">
    <h2 id="editor-heading">Editor</h2>
    ${editor}
  </main>

  <section class="pane" id="preview" aria-labelledby="preview-heading">
    <h2 id="preview-heading">Preview</h2>
    ${preview}
  </section>
</div>

<script>${SCRIPT.replace("__CSRF__", jsonForScript(view.csrfToken))}</script>
${view.editor.status === "ready" ? `<script>${EDITOR_SCRIPT.replace("__CSRF__", jsonForScript(view.csrfToken))}</script>` : ""}
${view.editor.status === "ready" || view.editor.status === "create" ? `<script>${COLLECTION_LIFECYCLE_SCRIPT.replace("__CSRF__", jsonForScript(view.csrfToken))}</script>` : ""}
</body>
</html>
`;
}
