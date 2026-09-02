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
  | {
      status: "ready";
      draft: DraftRecord;
      media: MediaAsset[];
      publicationEnabled?: boolean;
      publishedRevisionNumber?: number | null;
    }
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
  options: {
    type?: string;
    hint?: string;
    autocomplete?: string;
    readOnly?: boolean;
  } = {}
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
  const readOnly = options.readOnly ? " readonly" : "";

  return `<div class="field">
  <label class="field-label" for="${id}">${escapeHtml(label)}</label>
  ${hint}
  <input id="${id}" name="${escapeHtml(name)}" type="${escapeHtml(options.type ?? "text")}" value="${escapeHtml(value)}" data-field="${escapeHtml(name)}" aria-describedby="${describedBy}"${autocomplete}${readOnly}>
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
  <div class="media-upload" data-media-upload>
    <label for="${id}-upload">
      <span class="field-label">Upload a new image</span>
      <span class="field-hint">JPEG, PNG, or WebP. The new image is selected here after upload.</span>
      <input id="${id}-upload" type="file" accept="image/jpeg,image/png,image/webp" data-media-file>
    </label>
    <button type="button" class="quiet" data-media-upload-button data-media-target="${escapeHtml(name)}.mediaAssetId">Upload image</button>
    <span class="media-upload-status" data-media-upload-status></span>
  </div>
  <label for="${id}-alt">
    <span class="field-label">Alt text</span>
    <span class="field-hint" id="${id}-alt-hint">Describe this use of the image. Required before publication.</span>
    <input id="${id}-alt" name="${escapeHtml(name)}.alt" value="${escapeHtml(reference?.alt ?? "")}" data-field="${escapeHtml(name)}.alt" aria-describedby="${id}-alt-hint ${findingId(`${name}.alt`)}">
  </label>
  ${finding(`${name}.alt`)}
  ${finding(name)}
</div>`;
}

function galleryRow(
  reference: MediaReference | null,
  assets: MediaAsset[],
  index?: number
): string {
  const prefix = index === undefined ? "" : `gallery[${index}]`;
  const assetFinding =
    index === undefined ? "" : `finding-gallery-asset-${index}`;
  const altFinding = index === undefined ? "" : `finding-gallery-alt-${index}`;
  const options = assets
    .map((asset) => {
      const selected = asset.id === reference?.mediaAssetId ? " selected" : "";
      const label = asset.originalFilename || asset.providerPublicId;
      return `<option value="${escapeHtml(asset.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  return `<div class="gallery-row" data-gallery-row>
  <label>
    <span class="field-label">Image</span>
    <select data-gallery-asset${prefix ? ` name="${prefix}.mediaAssetId" data-field="${prefix}.mediaAssetId" aria-describedby="${assetFinding}"` : ""}>
      <option value="">Choose image</option>
      ${options}
    </select>
  </label>
  <label>
    <span class="field-label">Alt text</span>
    <input value="${escapeHtml(reference?.alt ?? "")}" data-gallery-alt${prefix ? ` name="${prefix}.alt" data-field="${prefix}.alt" aria-describedby="${altFinding}"` : ""}>
  </label>
  <div class="list-actions">
    <button type="button" data-gallery-action="up">Move up</button>
    <button type="button" data-gallery-action="down">Move down</button>
    <button type="button" data-gallery-action="remove">Remove</button>
  </div>
  <p class="field-finding" data-gallery-asset-finding${prefix ? ` id="${assetFinding}" data-finding-for="${prefix}.mediaAssetId"` : ""} hidden></p>
  <p class="field-finding" data-gallery-alt-finding${prefix ? ` id="${altFinding}" data-finding-for="${prefix}.alt"` : ""} hidden></p>
</div>`;
}

function projectGalleryField(
  gallery: MediaReference[],
  assets: MediaAsset[]
): string {
  const rows = gallery
    .map((reference, index) => galleryRow(reference, assets, index))
    .join("");

  return `<div class="field gallery-field">
  <span class="field-label">Lead gallery</span>
  <span class="field-hint">Up to eight images. Multiple images become an automatic carousel.</span>
  <div id="project-gallery">${rows}</div>
  <button type="button" class="quiet" id="add-gallery-image">Add existing image</button>
  <div class="media-upload" data-media-upload>
    <label>
      <span class="field-label">Upload gallery image</span>
      <span class="field-hint">JPEG, PNG, or WebP. Upload adds a new gallery row.</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-media-file>
    </label>
    <button type="button" class="quiet" data-media-upload-button data-gallery-upload-button>Upload and add</button>
    <span class="media-upload-status" data-media-upload-status></span>
  </div>
  ${finding("gallery")}
  <template id="gallery-image-template">${galleryRow(null, assets)}</template>
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
  const findingId = index === undefined ? "" : `finding-technology-${index}`;
  return `<div class="technology-row" data-technology-row>
  <label>
    <span class="field-label">Technology</span>
    <input value="${escapeHtml(value)}" data-technology${field ? ` name="${field}" data-field="${field}" aria-describedby="${findingId}"` : ""}>
  </label>
  <div class="list-actions">
    <button type="button" data-technology-action="up">Move up</button>
    <button type="button" data-technology-action="down">Move down</button>
    <button type="button" data-technology-action="remove">Remove</button>
  </div>
  <p class="field-finding" data-technology-finding${field ? ` id="${findingId}" data-finding-for="${field}"` : ""} hidden></p>
</div>`;
}

function technologyField(technologies: string[]): string {
  const rows = technologies
    .map((technology, index) => technologyRow(technology, index))
    .join("");

  return `<div class="field">
  <span class="field-label">Technologies</span>
  <span class="field-hint">Up to twenty. Brand logos are matched automatically and shown in this order.</span>
  <div id="technologies">${rows}</div>
  <button type="button" class="quiet" id="add-technology">Add technology</button>
  ${finding("technologies")}
  <template id="technology-template">${technologyRow("")}</template>
</div>`;
}

function projectFields(
  draft: DraftRecord,
  data: ProjectContent,
  assets: MediaAsset[],
  published: boolean
): string {
  return `<fieldset>
  <legend>Content</legend>
  ${input("title", "Title", data.title)}
</fieldset>
<fieldset>
  <legend>Media</legend>
  <p class="fieldset-note">All Project images are center-cropped to 1440×900 (8:5). Upload at that size when crop position matters.</p>
  ${mediaField("card", "Main image", data.card, assets)}
  ${projectGalleryField(data.gallery, assets)}
  ${input("videoUrl", "Lead video", data.videoUrl ?? "", { hint: "Optional /public/*.mp4 or *.webm path, or Cloudinary video URL. Display is capped at 1920×1080." })}
</fieldset>
<fieldset>
  <legend>Description</legend>
  ${textarea("summary", "Description", data.summary, "Plain text shown below the main media. Warning after 320 characters.", 4)}
  ${technologyField(data.technologies)}
  ${textarea("bodyMarkdown", "Article", data.bodyMarkdown, "Controlled Markdown: H2–H4, lists, tables, code, links, and Media tokens. Raw HTML is not allowed.", 16)}
</fieldset>
<fieldset>
  <legend>Metadata</legend>
  ${input("slug", "Public route slug", draft.slug ?? "", { hint: published ? "A changed route stays private until publication. Former routes redirect permanently." : "Controls the Project's first Public route. Title edits never change it automatically.", readOnly: published })}
  ${published ? '<button type="button" class="quiet" data-change-url>Change URL</button>' : ""}
  ${input("displayOrder", "Display order", String(draft.displayOrder ?? ""), { type: "number", hint: "Lower numbers appear first." })}
  ${seoFields(data.seo, assets)}
</fieldset>`;
}

function blogPostFields(
  draft: DraftRecord,
  data: BlogPostContent,
  assets: MediaAsset[],
  published: boolean
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
  ${input("slug", "Public route slug", draft.slug ?? "", { hint: published ? "A changed route stays private until publication. Former routes redirect permanently." : "Controls the Blog post's first Public route. Title edits never change it automatically.", readOnly: published })}
  ${published ? '<button type="button" class="quiet" data-change-url>Change URL</button>' : ""}
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
      fields = projectFields(
        draft,
        draft.data as ProjectContent,
        media,
        Boolean(panel.publishedRevisionNumber)
      );
      break;
    case "blog_post":
      fields = blogPostFields(
        draft,
        draft.data as BlogPostContent,
        media,
        Boolean(panel.publishedRevisionNumber)
      );
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
    ? panel.publishedRevisionNumber
      ? `<button type="button" disabled title="Published Content items cannot be deleted">${deleteLabel}</button>`
      : `<button type="button" id="delete-content">${deleteLabel}</button>`
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
  const publishDisabled = panel.publicationEnabled ? "" : " disabled";
  const publicationMessage = panel.publicationEnabled
    ? panel.publishedRevisionNumber
      ? `Published revision ${panel.publishedRevisionNumber}.`
      : "Not published yet."
    : "Publishing unlocks after the database cutover is sealed.";
  const changeUrlDialog =
    collection && panel.publishedRevisionNumber
      ? `<dialog id="change-url-dialog" aria-labelledby="change-url-heading" aria-describedby="change-url-description">
  <h3 id="change-url-heading">Change Public route?</h3>
  <p id="change-url-description">Changing this address can affect saved links and search results. The current route stays public until you Publish; afterward it redirects permanently to the new route.</p>
  <div class="field">
    <label class="field-label" for="change-url-value">New route slug</label>
    <span class="field-hint">${collection === "project" ? "/projects/" : "/blog/"}</span>
    <input id="change-url-value" value="${escapeHtml(draft.slug ?? "")}">
  </div>
  <div class="dialog-actions">
    <form method="dialog"><button value="cancel">Cancel</button></form>
    <button type="button" class="primary" id="confirm-change-url">Use in Content draft</button>
  </div>
</dialog>`
      : "";

  return `<form id="content-editor" data-content-id="${escapeHtml(draft.id)}" data-content-type="${escapeHtml(draft.type)}" data-updated-at="${escapeHtml(draft.updatedAt)}" data-draft-version="${draft.draftVersion}" data-slug="${escapeHtml(draft.slug ?? "")}" data-display-order="${escapeHtml(String(draft.displayOrder ?? ""))}" data-published-at="${escapeHtml(draft.publishedAt ?? "")}" data-publish-findings="${escapeHtml(JSON.stringify(draft.publishFindings))}">
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
    <button type="button" class="primary" id="publish-content"${publishDisabled}>Publish</button>
    <button type="button" id="view-history">History</button>
    ${deleteControl}
    <span>${publicationMessage}</span>
  </div>
</form>
${deleteDialog}
${changeUrlDialog}
<dialog id="publication-history" aria-labelledby="publication-history-heading">
  <h3 id="publication-history-heading">Publication history</h3>
  <div id="publication-history-list"><p>Loading history…</p></div>
  <form method="dialog"><button value="close">Close</button></form>
</dialog>
<dialog id="draft-conflict-dialog" aria-labelledby="draft-conflict-heading" aria-describedby="draft-conflict-description">
  <h3 id="draft-conflict-heading">This Content draft changed elsewhere</h3>
  <p id="draft-conflict-description">Reload the latest draft before editing again. Copy your unsaved values first if you need to keep them.</p>
  <label class="field-label" for="unsaved-content">Unsaved values</label>
  <textarea id="unsaved-content" rows="8" readonly></textarea>
  <div class="dialog-actions">
    <button type="button" id="copy-unsaved-content">Copy unsaved text</button>
    <button type="button" class="primary" id="reload-latest-draft">Reload latest draft</button>
  </div>
</dialog>`;
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
