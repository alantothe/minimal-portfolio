/**
 * Assembling the server-rendered document.
 *
 * Extracted from `shell.ts` so the legacy renderer and the database-backed one
 * build their page the same way. #34 requires SSR and JSON to describe one
 * generation; that guarantee is worth very little if the two renderers also
 * disagree about *where in the document* the content goes, so the placement
 * rules live in one place and both callers get them by construction.
 *
 * Everything here is a pure string transform. No content is read, no
 * configuration is consulted, and nothing decides what a page says — this module
 * only decides where it lands.
 */

/** The page container each route activates. */
export type ContainerId =
  | "home-page"
  | "about-page"
  | "blog-page"
  | "projects-page"
  | "blog-post-page"
  | "project-page";

const pageStylesheetLink = /<link\b(?=[^>]*\bid=(["'])page-css\1)[^>]*>/;

/**
 * Points the page stylesheet at the route's own CSS.
 *
 * Throws rather than silently serving an unstyled page: a shell that lost its
 * stylesheet link is a broken build, and every route would be affected
 * identically, so failing loudly is the only way it gets noticed before deploy.
 */
export function replacePageStylesheet(html: string, pageCss: string): string {
  if (!pageStylesheetLink.test(html)) {
    throw new Error("SSR shell is missing the page stylesheet link");
  }

  return html.replace(
    pageStylesheetLink,
    `<link id="page-css" rel="stylesheet" href="${pageCss}">`
  );
}

/**
 * Moves the active container and fills it.
 *
 * The order matters and is the reason this is one function rather than three.
 * Home is marked active in the static shell, so it has to be deactivated
 * *before* the target is activated — otherwise a request for `/about` produces a
 * document with two active containers, and the SPA router shows whichever the
 * stylesheet happens to reach first.
 */
export function injectPageContent(
  html: string,
  containerId: ContainerId,
  content: string
): string {
  if (content === "") return html;

  return html
    .replace(
      'id="home-page" class="page-container active"',
      'id="home-page" class="page-container"'
    )
    .replace(
      `id="${containerId}" class="page-container"`,
      `id="${containerId}" class="page-container active"`
    )
    .replace(
      `<div id="${containerId}" class="page-container active"></div>`,
      `<div id="${containerId}" class="page-container active">${content}</div>`
    );
}

/** Swaps the placeholder title element for the route's full head metadata. */
export function applySeoHead(html: string, seoHead: string): string {
  return html.replace("<title>Portfolio</title>", seoHead);
}
