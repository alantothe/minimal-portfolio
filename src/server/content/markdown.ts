/**
 * The restricted-Markdown boundary.
 *
 * #32 draws a hard line: content stores Markdown *source*, and one allowlisted
 * parser turns it into HTML for both draft preview and public output. Raw HTML,
 * scripts, styles, iframes, embeds, custom classes, arbitrary image URLs, and
 * transformation syntax are all forbidden.
 *
 * The design decision that makes that enforceable is what this module does
 * *not* do: it never passes source through a sanitiser and hopes. It walks the
 * token tree and builds the output string itself, emitting only tags it has
 * chosen, with text escaped at every leaf. An unrecognised token cannot produce
 * output because there is no code path that would render one. Sanitising is a
 * denylist wearing an allowlist's clothes — it has to anticipate the attack;
 * this does not.
 *
 * Two profiles, because the two places Markdown appears have different needs:
 *
 * - `short` — Home and About copy. Paragraphs, emphasis, strong, safe links.
 *   No headings, because these fields sit inside a page whose structure the
 *   template owns.
 * - `body` — Project and Blog-post bodies. Adds H2–H4, lists, blockquotes,
 *   tables, thematic breaks, code, and inline Media. H1 is excluded: the page
 *   title owns it, and a second H1 breaks both the outline and the SEO the
 *   golden contract pins.
 *
 * Images are the sharpest edge. A Markdown image may only target
 * `media:<asset-id>` — an application-owned reference resolved through the
 * closed variant renderer. An arbitrary URL fails closed rather than being
 * fetched, proxied, or hot-linked.
 */

import { Lexer, type Token, type Tokens } from "marked";
import {
  normalizeText,
  validateMarkdownLinkTarget,
  type Finding,
} from "./validation";

export type MarkdownProfile = "short" | "body";

/** How an inline image names its asset. */
export const MEDIA_REFERENCE_PREFIX = "media:";

/** Inline images render at one fixed variant; the author does not choose. */
export const INLINE_IMAGE_VARIANT = "portfolio_wide";

export interface RenderedImage {
  url: string;
  width: number;
  height: number;
}

export interface MarkdownContext {
  /** Returns null when the asset is unknown, not ready, or deleted. */
  resolveMedia(mediaAssetId: string): RenderedImage | null;
}

/**
 * `text` is in both sets because it is not a construct an author writes — it is
 * what marked emits for the contents of a tight list item, where a `paragraph`
 * wrapper would be wrong. Its inline content is still profile-restricted.
 */
const BLOCK_TOKENS: Record<MarkdownProfile, ReadonlySet<string>> = {
  short: new Set(["paragraph", "space", "text"]),
  body: new Set([
    "paragraph",
    "space",
    "text",
    "heading",
    "list",
    "blockquote",
    "table",
    "hr",
    "code",
  ]),
};

const INLINE_TOKENS: Record<MarkdownProfile, ReadonlySet<string>> = {
  short: new Set(["text", "escape", "strong", "em", "link", "br"]),
  body: new Set([
    "text",
    "escape",
    "strong",
    "em",
    "link",
    "br",
    "codespan",
    "image",
  ]),
};

/** #32: the page title owns H1, and H5/H6 are not in the allowed set. */
const MIN_HEADING_DEPTH = 2;
const MAX_HEADING_DEPTH = 4;

function error(field: string, code: string): Finding {
  return { field, code, severity: "error" };
}

/**
 * Escapes text for HTML.
 *
 * Every one of these five matters somewhere: `&` first so later replacements
 * are not double-escaped, `<`/`>` for tags, and both quote characters because
 * escaped text is also interpolated into attributes here.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one attribute value that is not free text.
 *
 * A fenced block's language becomes a class name, so it is reduced to
 * characters that cannot end the attribute or introduce another one, rather
 * than escaped and trusted.
 */
function safeLanguage(value: string | undefined): string | null {
  if (!value) return null;

  const candidate = value.trim().toLowerCase();

  // Rejected outright rather than scrubbed. Stripping the offending characters
  // out of `js" onload="alert(1)` would leave a mangled class name that still
  // reads like the attack it came from; a fence whose language is not a plain
  // identifier simply has no language.
  return /^[a-z0-9+#-]{1,24}$/.test(candidate) ? candidate : null;
}

interface WalkState {
  field: string;
  profile: MarkdownProfile;
  context: MarkdownContext | null;
  findings: Finding[];
}

function inlineTokens(token: Token): Token[] {
  return ((token as { tokens?: Token[] }).tokens ?? []) as Token[];
}

/**
 * Renders inline content.
 *
 * Anything not in the profile's set is reported and contributes nothing to the
 * output. Dropping rather than escaping-and-including is deliberate: a rejected
 * `<script>` should not reappear as visible text in the middle of a sentence.
 */
function renderInline(tokens: Token[], state: WalkState): string {
  const allowed = INLINE_TOKENS[state.profile];
  let html = "";

  for (const token of tokens) {
    if (!allowed.has(token.type)) {
      // `html` covers raw tags, including `<script>` and `<iframe>`; `del`,
      // `image` in a short field, and anything a future marked version adds
      // all land here too.
      state.findings.push(
        error(state.field, `disallowed_inline:${token.type}`)
      );
      continue;
    }

    switch (token.type) {
      case "text":
      case "escape":
        html += escapeHtml((token as Tokens.Text).text);
        break;

      case "br":
        html += "<br>";
        break;

      case "strong":
        html += `<strong>${renderInline(inlineTokens(token), state)}</strong>`;
        break;

      case "em":
        html += `<em>${renderInline(inlineTokens(token), state)}</em>`;
        break;

      case "codespan":
        html += `<code>${escapeHtml((token as Tokens.Codespan).text)}</code>`;
        break;

      case "link":
        html += renderLink(token as Tokens.Link, state);
        break;

      case "image":
        html += renderImage(token as Tokens.Image, state);
        break;
    }
  }

  return html;
}

function renderLink(token: Tokens.Link, state: WalkState): string {
  const href = normalizeText(token.href ?? "");
  const findings = validateMarkdownLinkTarget(state.field, href);

  if (findings.length > 0) {
    state.findings.push(...findings);
    // The text survives, the link does not. The reader still sees the sentence.
    return renderInline(inlineTokens(token), state);
  }

  const label = renderInline(inlineTokens(token), state);

  // External links get `rel` per #32. `noopener` is the security half —
  // without it the opened page can navigate this one via `window.opener`.
  const external = href.startsWith("https://");
  const attributes = external
    ? ' target="_blank" rel="noopener noreferrer"'
    : "";

  return `<a href="${escapeHtml(href)}"${attributes}>${label}</a>`;
}

/**
 * Renders an inline Media reference.
 *
 * The only accepted target is `media:<asset-id>`. Everything else — an https
 * URL, a local path, a data URI — is refused, because an image the application
 * did not record is one it cannot resolve, verify, size, or delete.
 */
function renderImage(token: Tokens.Image, state: WalkState): string {
  const href = normalizeText(token.href ?? "");
  const alt = normalizeText(token.text ?? "");
  const caption = normalizeText(token.title ?? "");

  if (!href.startsWith(MEDIA_REFERENCE_PREFIX)) {
    state.findings.push(error(state.field, "arbitrary_image_url"));
    return "";
  }

  const mediaAssetId = href.slice(MEDIA_REFERENCE_PREFIX.length).trim();

  if (mediaAssetId === "") {
    state.findings.push(error(state.field, "media_reference_missing_id"));
    return "";
  }

  // #32: alt text is required for a meaningful image. An image with none is a
  // publish blocker, not something to render with an empty attribute.
  if (alt === "") {
    state.findings.push(error(state.field, "alt_text_required"));
  }

  if (!state.context) {
    // Validation-only pass. The reference is well-formed; whether the asset
    // exists is a question for the render pass, which has a resolver.
    return "";
  }

  const image = state.context.resolveMedia(mediaAssetId);

  if (!image) {
    state.findings.push(error(state.field, "media_asset_unavailable"));
    return "";
  }

  // `width`/`height` come from the variant so the browser reserves the right
  // box before the image arrives.
  const img =
    `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(alt)}"` +
    ` width="${image.width}" height="${image.height}"` +
    ` loading="lazy" decoding="async">`;

  return caption === ""
    ? `<figure>${img}</figure>`
    : `<figure>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function renderList(token: Tokens.List, state: WalkState): string {
  const tag = token.ordered ? "ol" : "ul";
  // A list starting at something other than 1 keeps its numbering; the value is
  // a number, so it cannot carry markup.
  const start =
    token.ordered && typeof token.start === "number" && token.start !== 1
      ? ` start="${token.start}"`
      : "";

  const items = token.items
    .map((item) => `<li>${renderBlocks(item.tokens ?? [], state)}</li>`)
    .join("");

  return `<${tag}${start}>${items}</${tag}>`;
}

function renderTable(token: Tokens.Table, state: WalkState): string {
  const alignment = (value: string | null) =>
    value === "center" || value === "left" || value === "right"
      ? ` style="text-align:${value}"`
      : "";

  const head = token.header
    .map(
      (cell, index) =>
        `<th${alignment(token.align?.[index] ?? null)}>` +
        `${renderInline(cell.tokens ?? [], state)}</th>`
    )
    .join("");

  const body = token.rows
    .map(
      (row) =>
        "<tr>" +
        row
          .map(
            (cell, index) =>
              `<td${alignment(token.align?.[index] ?? null)}>` +
              `${renderInline(cell.tokens ?? [], state)}</td>`
          )
          .join("") +
        "</tr>"
    )
    .join("");

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderBlocks(tokens: Token[], state: WalkState): string {
  const allowed = BLOCK_TOKENS[state.profile];
  let html = "";

  for (const token of tokens) {
    if (!allowed.has(token.type)) {
      state.findings.push(error(state.field, `disallowed_block:${token.type}`));
      continue;
    }

    switch (token.type) {
      case "space":
        break;

      case "paragraph":
        html += `<p>${renderInline(inlineTokens(token), state)}</p>`;
        break;

      case "text":
        // Tight list item content: inline, with no block wrapper of its own.
        html += renderInline(inlineTokens(token), state);
        break;

      case "heading": {
        const heading = token as Tokens.Heading;
        if (
          heading.depth < MIN_HEADING_DEPTH ||
          heading.depth > MAX_HEADING_DEPTH
        ) {
          // An H1 here would compete with the page title for the document
          // outline, which the golden contract pins.
          state.findings.push(
            error(state.field, `heading_level_not_allowed:${heading.depth}`)
          );
          break;
        }
        html +=
          `<h${heading.depth}>` +
          `${renderInline(inlineTokens(token), state)}</h${heading.depth}>`;
        break;
      }

      case "list":
        html += renderList(token as Tokens.List, state);
        break;

      case "blockquote":
        html += `<blockquote>${renderBlocks(
          inlineTokens(token),
          state
        )}</blockquote>`;
        break;

      case "table":
        html += renderTable(token as Tokens.Table, state);
        break;

      case "hr":
        html += "<hr>";
        break;

      case "code": {
        const code = token as Tokens.Code;
        const language = safeLanguage(code.lang);
        const openTag = language
          ? `<code class="language-${language}">`
          : "<code>";
        html += `<pre>${openTag}${escapeHtml(code.text)}</code></pre>`;
        break;
      }
    }
  }

  return html;
}

export interface RenderedMarkdown {
  html: string;
  findings: Finding[];
}

/**
 * Parses and renders in one pass.
 *
 * One pass rather than validate-then-render because the two must never
 * disagree: a construct that validation accepted but rendering dropped, or
 * vice versa, is exactly the gap an injection lives in.
 */
export function renderMarkdown(
  field: string,
  source: string,
  profile: MarkdownProfile,
  context: MarkdownContext | null = null
): RenderedMarkdown {
  const state: WalkState = { field, profile, context, findings: [] };

  if (normalizeText(source) === "") {
    return { html: "", findings: [] };
  }

  let tokens: Token[];
  try {
    // The lexer only. `marked.parse` would run its own renderer, which emits
    // raw HTML passthrough by design.
    tokens = Lexer.lex(source);
  } catch {
    return { html: "", findings: [error(field, "markdown_parse_failed")] };
  }

  const html = renderBlocks(tokens, state);

  return { html, findings: state.findings };
}

/**
 * Checks source without needing a media resolver.
 *
 * Used at draft-save and publish time, where the question is whether the
 * Markdown is acceptable rather than what it looks like. Media *existence* is
 * only checked when a resolver is supplied, so a draft referencing an asset
 * that is still uploading is not an error.
 */
export function validateMarkdown(
  field: string,
  source: string,
  profile: MarkdownProfile
): Finding[] {
  return renderMarkdown(field, source, profile, null).findings;
}
