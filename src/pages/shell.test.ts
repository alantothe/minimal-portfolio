import { describe, expect, test } from "bun:test";

const shell = await Bun.file(import.meta.dir + "/shell.html").text();
const router = await Bun.file(
  import.meta.dir + "/../public/spa-router.js"
).text();
const githubActivity = await Bun.file(
  import.meta.dir + "/../public/github-activity.js"
).text();
const homeStyles = await Bun.file(import.meta.dir + "/home/styles.css").text();
const globalStyles = await Bun.file(
  import.meta.dir + "/../public/css/global.css"
).text();
const imageLoader = await Bun.file(
  import.meta.dir + "/../public/image-loader.js"
).text();

describe("SPA navigation", () => {
  test("does not fade page content during menu navigation", () => {
    expect(shell).not.toContain(".page-container.active.navigating");
    expect(router).not.toContain("pageContainer.classList.add('navigating')");
  });

  test("preserves server-rendered content during initial boot", () => {
    expect(router).not.toContain("preloadAllPages");
    expect(router).not.toContain("fetch('/api/pages')");
    expect(router).not.toContain("const allImages");
  });

  test("recognizes direct blog and project detail routes", () => {
    expect(router).toContain("getInitialRoute");
    expect(router).toMatch(/page:\s*["']blog-post["']/);
    expect(router).toMatch(/page:\s*["']project["']/);
  });

  test("supports internal content links through SPA navigation", () => {
    expect(router).toContain("a.nav-link, a[data-spa-link]");
  });

  test("keeps authenticated preview navigation on one published generation", () => {
    expect(router).toContain("__PORTFOLIO_PREVIEW_ROUTE__");
    expect(router).toContain("attachPreviewNavigation");
    expect(router).toContain("/admin/preview?route=");
    expect(router).toMatch(
      /!this\.previewRoute\s*&&\s*initialRoute\.page === "blog-post"/
    );
  });

  test("revalidates SPA pages only after the database-backed cutover", () => {
    expect(router).toContain("dataset.publicationGeneration");
    expect(router).toContain("publishedSite ||");
    expect(shell).not.toContain("data-publication-generation");
  });

  test("accounts for the desktop top inset in the sticky sidebar height", () => {
    expect(globalStyles).not.toMatch(
      /\.sidebar\s*\{[^}]*height:\s*100vh;[^}]*\}/
    );
    expect(globalStyles).toMatch(
      /\.sidebar\s*\{[^}]*height:\s*calc\(100vh - 130px\);[^}]*\}/
    );
  });

  test("supports pinning and dismissing the GitHub activity popover", () => {
    expect(imageLoader).toContain('import("/public/github-activity.js")');
    expect(githubActivity).toContain("attachGitHubActivityListener");
    expect(githubActivity).toContain('event.key === "Escape"');
    expect(githubActivity).toContain('"focusout"');
    expect(githubActivity).toContain("aria-expanded");
  });

  test("matches the GitHub activity popover height to the stats", () => {
    expect(homeStyles).toMatch(/\.stats \{[^}]*position: relative;/);
    expect(homeStyles).toMatch(
      /\.github-activity__panel \{[^}]*height: 100%;[^}]*left: calc\(100% \+ 14px\);[^}]*width: min\(420px, calc\(100vw - 40px\)\);/
    );
    expect(homeStyles).toMatch(
      /\.github-activity__chevron \{[^}]*opacity: 0\.85;[^}]*transform: rotate\(-90deg\);[^}]*transition: opacity 140ms ease;/
    );
    expect(homeStyles).toMatch(
      /\.github-activity__profile-link \{[^}]*color: var\(--github-accent\);/
    );
    expect(homeStyles).toContain("var(--home-accent) 42%");
    expect(homeStyles).toMatch(
      /\.github-activity__profile-text \{[^}]*color: var\(--github-text-rest\);[^}]*text-decoration-color: var\(--github-text-rest\);/
    );
    expect(homeStyles).toMatch(
      /\.github-activity:hover \.github-activity__profile-text,[^}]*color: var\(--github-accent\);[^}]*text-decoration-color: var\(--github-accent\);/
    );
    expect(homeStyles).toMatch(
      /\.github-activity__profile-link svg \{[^}]*color: var\(--github-text-rest\);/
    );
    expect(homeStyles).toMatch(
      /\.github-activity:hover \.github-activity__profile-link svg,[^}]*color: var\(--github-accent\);/
    );
    expect(homeStyles).toContain(
      ".github-activity:focus-within > .github-activity__panel"
    );
    expect(homeStyles).toMatch(
      /\.github-activity__heatmap \{[^}]*height: 100%;[^}]*width: 100%;/
    );
    expect(homeStyles).toMatch(
      /\.stat-highlight \{[^}]*cursor: default;[^}]*\}/
    );
    expect(homeStyles).toMatch(
      /#copy-email \{[^}]*color: var\(--home-accent-rest\);[^}]*text-decoration-color: var\(--home-accent-rest\);/
    );
    expect(homeStyles).toMatch(
      /#copy-email:hover,[^}]*color: var\(--home-accent\);[^}]*text-decoration-color: var\(--home-accent\);/
    );
    expect(homeStyles).toContain("@media (max-width: 900px)");
  });
});
