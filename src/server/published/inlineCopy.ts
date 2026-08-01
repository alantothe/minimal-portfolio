/**
 * The behaviour hooks the system owns, put back after content rendering.
 *
 * #36 draws a hard line here: content stores no classes, no IDs, and no `data-*`
 * attributes. The importer therefore converted the Home contact span into a
 * plain `mailto:` link and the Home projects anchor into a plain internal link,
 * and the restricted Markdown renderer emits exactly that — no more.
 *
 * But the site has two real behaviours attached to those two elements: SPA
 * navigation, and click-to-copy on the email address. Both are presentation the
 * system decides, so they are re-attached here, downstream of content, where an
 * Owner cannot reach them. An Owner writing `[projects](/projects)` gets a
 * working SPA link; an Owner writing `<a data-spa-link>` gets a validation
 * error, which is the point.
 *
 * This module never parses HTML in general. It matches the exact shapes the
 * restricted renderer produces, and leaves anything else untouched — an inline
 * post-processor that tried to be a real HTML rewriter would be a second, weaker
 * sanitiser sitting downstream of the real one.
 */

/** The class the stylesheet uses for inline links inside body copy. */
const INLINE_LINK_CLASS = "home-inline-link";

/** The id the click-to-copy script binds to. There is exactly one per page. */
const COPY_EMAIL_ID = "copy-email";

/**
 * Unwraps a single-paragraph render.
 *
 * Short-profile fields are placed by the page template, which already supplies
 * the element and its class — `<p class="intro">…</p>` on Home, for instance. A
 * render that came back as one paragraph is therefore handed back as its inline
 * contents so it lands inside that element rather than nesting a bare `<p>`
 * inside a styled one.
 *
 * Anything else — zero paragraphs, or several — is returned unchanged. A
 * multi-paragraph field is a block the template must place as a block, and
 * silently concatenating the paragraphs would delete the boundaries between
 * them.
 */
export function unwrapSingleParagraph(html: string): string {
  const match = /^<p>([\s\S]*)<\/p>$/.exec(html.trim());

  if (!match) return html;

  // A second paragraph boundary inside the match means this was not one
  // paragraph, it was several and the regex spanned them.
  return match[1]!.includes("</p>") ? html : match[1]!;
}

/**
 * Re-attaches the SPA hook to internal links.
 *
 * Only site-relative targets. An external link is somebody else's page and must
 * cause a real navigation, and the `rel`/`target` pair the content renderer
 * already put on it is the security half of that.
 */
function attachSpaLinks(html: string): string {
  return html.replace(
    /<a href="(\/[^"]*)">/g,
    (_match, href: string) =>
      `<a class="${INLINE_LINK_CLASS}" href="${href}" data-spa-link>`
  );
}

/**
 * Turns the first `mailto:` link into the click-to-copy control.
 *
 * Only the first. The id is a document-unique hook the script binds to, and
 * emitting it twice would produce invalid HTML and a control that copies the
 * wrong address. A second `mailto:` stays a working mail link, which degrades
 * honestly rather than silently.
 */
function attachCopyEmail(html: string): string {
  let replaced = false;

  return html.replace(
    /<a href="mailto:([^"]*)">([\s\S]*?)<\/a>/g,
    (match, email: string, label: string) => {
      if (replaced) return match;
      replaced = true;
      return `<span id="${COPY_EMAIL_ID}" data-email="${email}">${label}</span>`;
    }
  );
}

/**
 * Prepares a short content field for placement inside a page template.
 *
 * One function rather than three exported steps, because the order matters: the
 * copy-email rewrite must see the anchor the content renderer produced, and the
 * SPA rewrite must not then match the anchor the copy rewrite already removed.
 */
export function toInlineHtml(html: string): string {
  return attachSpaLinks(attachCopyEmail(unwrapSingleParagraph(html)));
}
