/** Server-rendered singleton editor forms for the Workbench's centre pane. */

import type { MediaAsset } from "../database/mediaRepository";
import type {
  AboutContent,
  BrandingContent,
  HomeContent,
  MediaReference,
  SeoOverrides,
} from "../content/schema";
import type { DraftRecord } from "./contentDraft";
import { escapeHtml } from "./html";

export type EditorPanel =
  | { status: "ready"; draft: DraftRecord; media: MediaAsset[] }
  | { status: "deferred"; label: string }
  | { status: "missing"; message: string };

function findingId(field: string): string {
  return `finding-${field.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function finding(field: string): string {
  return `<p class="field-finding" id="${findingId(field)}" data-finding-for="${escapeHtml(field)}" hidden></p>`;
}

function input(
  name: string,
  label: string,
  value: string,
  options: { type?: string; hint?: string; autocomplete?: string } = {}
): string {
  const id = `field-${name.replaceAll(".", "-")}`;
  const hint = options.hint
    ? `<span class="field-hint" id="${id}-hint">${escapeHtml(options.hint)}</span>`
    : "";
  const describedBy = [options.hint ? `${id}-hint` : "", findingId(name)]
    .filter(Boolean)
    .join(" ");
  const autocomplete = options.autocomplete
    ? ` autocomplete="${escapeHtml(options.autocomplete)}"`
    : "";

  return `<div class="field">
  <label class="field-label" for="${id}">${escapeHtml(label)}</label>
  ${hint}
  <input id="${id}" name="${escapeHtml(name)}" type="${escapeHtml(options.type ?? "text")}" value="${escapeHtml(value)}" data-field="${escapeHtml(name)}" aria-describedby="${describedBy}"${autocomplete}>
  ${finding(name)}
</div>`;
}

function textarea(
  name: string,
  label: string,
  value: string,
  hint: string
): string {
  const id = `field-${name.replaceAll(".", "-")}`;
  return `<div class="field">
  <label class="field-label" for="${id}">${escapeHtml(label)}</label>
  <span class="field-hint" id="${id}-hint">${escapeHtml(hint)}</span>
  <textarea id="${id}" name="${escapeHtml(name)}" rows="6" data-field="${escapeHtml(name)}" aria-describedby="${id}-hint ${findingId(name)}">${escapeHtml(value)}</textarea>
  ${finding(name)}
</div>`;
}

function mediaField(
  name: string,
  label: string,
  reference: MediaReference | null,
  assets: MediaAsset[]
): string {
  const id = `field-${name.replaceAll(".", "-")}`;
  const options = assets
    .map((asset) => {
      const selected = asset.id === reference?.mediaAssetId ? " selected" : "";
      const assetLabel = asset.originalFilename || asset.providerPublicId;
      return `<option value="${escapeHtml(asset.id)}"${selected}>${escapeHtml(assetLabel)}</option>`;
    })
    .join("");

  return `<div class="field media-field">
  <label for="${id}-asset">
    <span class="field-label">${escapeHtml(label)}</span>
    <select id="${id}-asset" name="${escapeHtml(name)}.mediaAssetId" data-field="${escapeHtml(name)}.mediaAssetId" aria-describedby="${findingId(`${name}.mediaAssetId`)} ${findingId(name)}">
      <option value="">No image</option>
      ${options}
    </select>
  </label>
  ${finding(`${name}.mediaAssetId`)}
  <label for="${id}-alt">
    <span class="field-label">Alt text</span>
    <span class="field-hint" id="${id}-alt-hint">Describe this use of the image. Required before publication.</span>
    <input id="${id}-alt" name="${escapeHtml(name)}.alt" value="${escapeHtml(reference?.alt ?? "")}" data-field="${escapeHtml(name)}.alt" aria-describedby="${id}-alt-hint ${findingId(`${name}.alt`)}">
  </label>
  ${finding(`${name}.alt`)}
  ${finding(name)}
</div>`;
}

function seoFields(seo: SeoOverrides, assets: MediaAsset[]): string {
  return `${input("seo.title", "Search title", seo.title ?? "", {
    hint: "Optional. Leave empty to use the page title.",
  })}
${textarea(
  "seo.description",
  "Search description",
  seo.description ?? "",
  "Optional summary for search and sharing previews."
)}
${mediaField("seo.sharingImage", "Sharing image", seo.sharingImage, assets)}`;
}

function homeFields(data: HomeContent, assets: MediaAsset[]): string {
  return `<fieldset>
  <legend>Content</legend>
  ${input("displayName", "Display name", data.displayName, { autocomplete: "name" })}
  ${input("professionalTitle", "Professional title", data.professionalTitle)}
  ${input("email", "Email", data.email, { type: "email", autocomplete: "email" })}
  ${input("githubUsername", "GitHub username", data.githubUsername)}
  ${textarea("introMarkdown", "Introduction", data.introMarkdown, "Short Markdown. Raw HTML is not allowed.")}
  ${textarea("bioMarkdown", "Biography", data.bioMarkdown, "Short Markdown. Raw HTML is not allowed.")}
</fieldset>
<fieldset>
  <legend>Media</legend>
  ${mediaField("portrait", "Portrait", data.portrait, assets)}
</fieldset>
<fieldset>
  <legend>Metadata</legend>
  ${seoFields(data.seo, assets)}
</fieldset>`;
}

function socialRow(label: string, url: string, index?: number): string {
  const labelField =
    index === undefined ? "" : ` data-field="socialLinks[${index}].label"`;
  const urlField =
    index === undefined ? "" : ` data-field="socialLinks[${index}].url"`;
  const labelFinding =
    index === undefined ? "" : `finding-social-label-${index}`;
  const urlFinding = index === undefined ? "" : `finding-social-url-${index}`;
  return `<div class="social-link-row">
  <label>
    <span class="field-label">Label</span>
    <input value="${escapeHtml(label)}" data-social-label${labelField}${labelFinding ? ` aria-describedby="${labelFinding}"` : ""}>
  </label>
  <label>
    <span class="field-label">HTTPS address</span>
    <input type="url" value="${escapeHtml(url)}" data-social-url${urlField}${urlFinding ? ` aria-describedby="${urlFinding}"` : ""}>
  </label>
  <div class="social-link-actions">
    <button type="button" data-social-action="up">Move up</button>
    <button type="button" data-social-action="down">Move down</button>
    <button type="button" data-social-action="remove">Remove</button>
  </div>
  <p class="field-finding" data-social-label-finding${index === undefined ? "" : ` id="${labelFinding}" data-finding-for="socialLinks[${index}].label"`} hidden></p>
  <p class="field-finding" data-social-url-finding${index === undefined ? "" : ` id="${urlFinding}" data-finding-for="socialLinks[${index}].url"`} hidden></p>
</div>`;
}

function aboutFields(data: AboutContent, assets: MediaAsset[]): string {
  const links = data.socialLinks
    .map((link, index) => socialRow(link.label, link.url, index))
    .join("");
  return `<fieldset>
  <legend>Content</legend>
  ${textarea("introMarkdown", "Introduction", data.introMarkdown, "Short Markdown. Raw HTML is not allowed.")}
  ${textarea("hobbiesMarkdown", "Hobbies", data.hobbiesMarkdown, "Short Markdown. Raw HTML is not allowed.")}
  ${input("featuredTitle", "Featured section title", data.featuredTitle)}
  ${textarea("featuredBodyMarkdown", "Featured section body", data.featuredBodyMarkdown, "Short Markdown. Raw HTML is not allowed.")}
  <div class="field social-links-field">
    <span class="field-label">Social links</span>
    <span class="field-hint">Up to eight links, displayed in this order.</span>
    <div id="social-links">${links}</div>
    <button type="button" class="quiet" id="add-social-link">Add social link</button>
    ${finding("socialLinks")}
  </div>
  <template id="social-link-template">${socialRow("", "")}</template>
</fieldset>
<fieldset>
  <legend>Media</legend>
  <p class="fieldset-note">The About page has no dedicated image. Its sharing image lives under Metadata.</p>
</fieldset>
<fieldset>
  <legend>Metadata</legend>
  ${seoFields(data.seo, assets)}
</fieldset>`;
}

function brandingFields(data: BrandingContent, assets: MediaAsset[]): string {
  return `<fieldset>
  <legend>Content</legend>
  <p class="fieldset-note">Branding is shared across the entire public site.</p>
</fieldset>
<fieldset>
  <legend>Media</legend>
  ${mediaField("logo", "Logo", data.logo, assets)}
  ${mediaField("defaultSharingImage", "Default sharing image", data.defaultSharingImage, assets)}
</fieldset>
<fieldset>
  <legend>Metadata</legend>
  <p class="fieldset-note">Page-level search metadata can override the default sharing image.</p>
</fieldset>`;
}

function readyPanel(panel: Extract<EditorPanel, { status: "ready" }>): string {
  const { draft, media } = panel;
  const fields =
    draft.type === "home"
      ? homeFields(draft.data as HomeContent, media)
      : draft.type === "about"
        ? aboutFields(draft.data as AboutContent, media)
        : brandingFields(draft.data as BrandingContent, media);

  return `<form id="content-editor" data-content-id="${escapeHtml(draft.id)}" data-content-type="${escapeHtml(draft.type)}" data-updated-at="${escapeHtml(draft.updatedAt)}" data-publish-findings="${escapeHtml(JSON.stringify(draft.publishFindings))}">
  <div class="editor-intro">
    <div>
      <p class="eyebrow">Singleton</p>
      <h3>${escapeHtml(draft.type === "home" ? "Home" : draft.type === "about" ? "About" : "Branding")}</h3>
    </div>
    <p>Autosaves after you pause. Publication requirements can remain unfinished in a draft.</p>
  </div>
  <div id="validation-summary" class="validation-summary" hidden></div>
  ${fields}
  <div class="editor-actions">
    <button type="submit" class="primary">Save now</button>
    <button type="button" disabled title="Publishing arrives in slice 8">Publish</button>
    <span>Publishing arrives in slice 8.</span>
  </div>
</form>`;
}

export function renderEditorPanel(panel: EditorPanel): string {
  switch (panel.status) {
    case "ready":
      return readyPanel(panel);
    case "deferred":
      return `<div class="empty-editor"><p class="eyebrow">Collection</p><h3>${escapeHtml(panel.label)}</h3><p>Collection editing arrives in the next Workbench slice.</p></div>`;
    case "missing":
      return `<div class="empty-editor"><p class="eyebrow">Unavailable</p><h3>Editor could not open</h3><p>${escapeHtml(panel.message)}</p></div>`;
  }
}
