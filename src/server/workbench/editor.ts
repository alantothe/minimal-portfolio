/** Server-rendered Content editor forms for the Workbench's centre pane. */

import type { MediaAsset } from "../database/mediaRepository";
import type {
  AboutContent,
  BrandingContent,
  HomeContent,
  MediaReference,
  ProjectContent,
  BlogPostContent,
  SeoOverrides,
} from "../content/schema";
import type { DraftRecord } from "./contentDraft";
import { escapeHtml } from "./html";
import { isSingletonType, type CollectionType } from "../content/identity";

export type EditorPanel =
  | { status: "ready"; draft: DraftRecord; media: MediaAsset[] }
  | { status: "create"; type: CollectionType }
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
  hint: string,
  rows = 6
): string {
  const id = `field-${name.replaceAll(".", "-")}`;
  return `<div class="field">
  <label class="field-label" for="${id}">${escapeHtml(label)}</label>
  <span class="field-hint" id="${id}-hint">${escapeHtml(hint)}</span>
  <textarea id="${id}" name="${escapeHtml(name)}" rows="${rows}" data-field="${escapeHtml(name)}" aria-describedby="${id}-hint ${findingId(name)}">${escapeHtml(value)}</textarea>
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

function technologyRow(value: string, index?: number): string {
  const field = index === undefined ? "" : `technologies[${index}]`;
  const finding = index === undefined ? "" : `finding-technology-${index}`;
  return `<div class="technology-row" data-list-row>
  <label>
    <span class="field-label">Technology</span>
    <input value="${escapeHtml(value)}" data-technology${field ? ` data-field="${field}" aria-describedby="${finding}"` : ""}>
  </label>
  <div class="list-actions">
    <button type="button" data-list-action="up">Move up</button>
    <button type="button" data-list-action="down">Move down</button>
    <button type="button" data-list-action="remove">Remove</button>
  </div>
  <p class="field-finding" data-technology-finding${field ? ` id="${finding}" data-finding-for="${field}"` : ""} hidden></p>
</div>`;
}

function projectFields(
  draft: DraftRecord,
  data: ProjectContent,
  assets: MediaAsset[]
): string {
  const technologies = data.technologies
    .map((technology, index) => technologyRow(technology, index))
    .join("");
  return `<fieldset>
  <legend>Content</legend>
  ${input("title", "Title", data.title)}
  ${textarea("summary", "Card summary", data.summary, "Plain text. Warning after 320 characters.", 4)}
  ${input("kicker", "Kicker", data.kicker)}
  ${input("role", "Your role", data.role)}
  ${input("status", "Project status", data.status)}
  ${input("period", "Display period", data.period)}
  ${input("liveUrl", "Live site", data.liveUrl ?? "", { type: "url", hint: "Optional absolute HTTPS address." })}
  ${input("repositoryUrl", "Repository", data.repositoryUrl ?? "", { type: "url", hint: "Optional absolute HTTPS address." })}
  ${input("accentColor", "Accent colour", data.accentColor, { hint: "Six-digit colour, for example #0b4fd4." })}
  <div class="field">
    <span class="field-label">Technologies</span>
    <span class="field-hint">Up to twenty, displayed in this order.</span>
    <div id="technologies">${technologies}</div>
    <button type="button" class="quiet" id="add-technology">Add technology</button>
    ${finding("technologies")}
  </div>
  <template id="technology-template">${technologyRow("")}</template>
  ${textarea("bodyMarkdown", "Project body", data.bodyMarkdown, "Controlled Markdown: H2–H4, lists, tables, code, links, and Media tokens. Raw HTML is not allowed.", 16)}
</fieldset>
<fieldset>
  <legend>Media</legend>
  ${mediaField("card", "Project card", data.card, assets)}
</fieldset>
<fieldset>
  <legend>Metadata</legend>
  ${input("slug", "Public route slug", draft.slug ?? "", { hint: "Controls the Project's Public route. Title edits never change it automatically." })}
  ${input("displayOrder", "Display order", String(draft.displayOrder ?? ""), { type: "number", hint: "Lower numbers appear first." })}
  ${seoFields(data.seo, assets)}
</fieldset>`;
}

function blogPostFields(
  draft: DraftRecord,
  data: BlogPostContent,
  assets: MediaAsset[]
): string {
  return `<fieldset>
  <legend>Content</legend>
  ${input("title", "Title", data.title)}
  ${textarea("excerpt", "Excerpt", data.excerpt, "Plain text. Warning after 320 characters.", 4)}
  ${textarea("bodyMarkdown", "Blog post body", data.bodyMarkdown, "Controlled Markdown: H2–H4, lists, tables, code, links, and Media tokens. Raw HTML is not allowed.", 18)}
</fieldset>
<fieldset>
  <legend>Media</legend>
  ${mediaField("sharingImage", "Sharing image", data.sharingImage, assets)}
</fieldset>
<fieldset>
  <legend>Metadata</legend>
  ${input("slug", "Public route slug", draft.slug ?? "", { hint: "Controls the Blog post's Public route. Title edits never change it automatically." })}
  ${input("publishedAt", "Publication date", draft.publishedAt ?? "", { type: "date", hint: "YYYY-MM-DD. Future dates are not scheduled." })}
  ${seoFields(data.seo, assets)}
</fieldset>`;
}

function readyPanel(panel: Extract<EditorPanel, { status: "ready" }>): string {
  const { draft, media } = panel;
  let fields: string;
  switch (draft.type) {
    case "home":
      fields = homeFields(draft.data as HomeContent, media);
      break;
    case "about":
      fields = aboutFields(draft.data as AboutContent, media);
      break;
    case "branding":
      fields = brandingFields(draft.data as BrandingContent, media);
      break;
    case "project":
      fields = projectFields(draft, draft.data as ProjectContent, media);
      break;
    case "blog_post":
      fields = blogPostFields(draft, draft.data as BlogPostContent, media);
      break;
  }

  const label = isSingletonType(draft.type)
    ? { home: "Home", about: "About", branding: "Branding" }[draft.type]
    : (draft.data as ProjectContent | BlogPostContent).title ||
      (draft.type === "project" ? "Untitled Project" : "Untitled Blog post");
  const kind = isSingletonType(draft.type) ? "Singleton" : "Collection item";
  const collection = isSingletonType(draft.type) ? null : draft.type;
  const deleteLabel =
    collection === "project" ? "Delete Project" : "Delete Blog post";
  const deleteControl = collection
    ? `<button type="button" id="delete-content">${deleteLabel}</button>`
    : "";
  const deleteDialog = collection
    ? `<dialog id="delete-content-dialog" aria-labelledby="delete-content-heading" aria-describedby="delete-content-description">
  <h3 id="delete-content-heading">${deleteLabel}?</h3>
  <p id="delete-content-description">This removes ${escapeHtml(label)} from the Content draft. Its identity and former Public route remain reserved.</p>
  <div class="dialog-actions">
    <form method="dialog"><button value="cancel">Cancel</button></form>
    <button type="button" class="danger" id="confirm-delete">${deleteLabel}</button>
  </div>
</dialog>`
    : "";

  return `<form id="content-editor" data-content-id="${escapeHtml(draft.id)}" data-content-type="${escapeHtml(draft.type)}" data-updated-at="${escapeHtml(draft.updatedAt)}" data-slug="${escapeHtml(draft.slug ?? "")}" data-display-order="${escapeHtml(String(draft.displayOrder ?? ""))}" data-published-at="${escapeHtml(draft.publishedAt ?? "")}" data-publish-findings="${escapeHtml(JSON.stringify(draft.publishFindings))}">
  <div class="editor-intro">
    <div>
      <p class="eyebrow">${kind}</p>
      <h3>${escapeHtml(label)}</h3>
    </div>
    <p>Autosaves after you pause. Publication requirements can remain unfinished in a draft.</p>
  </div>
  <div id="validation-summary" class="validation-summary" hidden></div>
  ${fields}
  <div class="editor-actions">
    <button type="submit" class="primary">Save now</button>
    <button type="button" disabled title="Publishing arrives in slice 8">Publish</button>
    ${deleteControl}
    <span>Publishing arrives in slice 8.</span>
  </div>
</form>
${deleteDialog}`;
}

function createPanel(type: CollectionType): string {
  const label = type === "project" ? "Project" : "Blog post";
  return `<form id="collection-create" data-content-type="${type}">
  <div class="editor-intro">
    <div>
      <p class="eyebrow">New collection item</p>
      <h3>Create ${label}</h3>
    </div>
    <p>Name the draft and confirm its Public route. Remaining editorial fields can stay unfinished.</p>
  </div>
  <div id="creation-summary" class="validation-summary" hidden></div>
  <div class="field">
    <label class="field-label" for="create-title">Title</label>
    <input id="create-title" name="title" data-create-field="title" aria-describedby="create-title-finding" autofocus>
    <p class="field-finding" id="create-title-finding" data-create-finding="title" hidden></p>
  </div>
  <div class="field">
    <label class="field-label" for="create-slug">Public route slug</label>
    <span class="field-hint" id="create-slug-hint">Leave empty to generate a suggestion from the title. Review and confirm it before creation.</span>
    <input id="create-slug" name="slug" data-create-field="slug" aria-describedby="create-slug-hint create-slug-finding">
    <p class="field-finding" id="create-slug-finding" data-create-finding="slug" hidden></p>
  </div>
  <p id="creation-guidance" class="fieldset-note">Creation starts an unpublished Content draft.</p>
  <div class="editor-actions">
    <button type="submit" class="primary">Create ${label}</button>
    <a class="button" href="/admin">Cancel</a>
  </div>
</form>`;
}

export function renderEditorPanel(panel: EditorPanel): string {
  switch (panel.status) {
    case "ready":
      return readyPanel(panel);
    case "create":
      return createPanel(panel.type);
    case "missing":
      return `<div class="empty-editor"><p class="eyebrow">Unavailable</p><h3>Editor could not open</h3><p>${escapeHtml(panel.message)}</p></div>`;
  }
}
