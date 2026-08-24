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

  test("uses a clear, accessible mobile menu control", () => {
    expect(shell).toMatch(
      /id="mobile-menu-toggle"[\s\S]*aria-controls="mobile-nav"[\s\S]*aria-expanded="false"[\s\S]*>\s*Menu\s*<\/button>/
    );
    expect(router).toContain(
      'menuToggle.setAttribute("aria-expanded", String(isOpen))'
    );
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

  test("locks the outer shell and scrolls only the inner page content", () => {
    expect(shell).toMatch(
      /html,\s*body\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/
    );
    expect(shell).toMatch(
      /\.container\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/
    );
    expect(globalStyles).toMatch(
      /#app-content\s*\{[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/
    );
    expect(globalStyles).toMatch(
      /#app-content\s*\{[^}]*scrollbar-width:\s*none;/
    );
    expect(globalStyles).toMatch(
      /#app-content::-webkit-scrollbar\s*\{[^}]*display:\s*none;/
    );
    expect(globalStyles).toMatch(
      /\.sidebar\s*\{[^}]*height:\s*100%;[^}]*flex-shrink:\s*0;/
    );
    expect(router).toMatch(
      /resetContentScroll\(\)\s*\{[\s\S]*?content\.scrollTop = 0;/
    );
    expect(router.match(/this\.resetContentScroll\(\);/g)).toHaveLength(3);
  });

  test("routes wheel gestures outside the content into the locked inner page", () => {
    expect(router).toContain("this.attachOuterWheelListener();");
    expect(router).toContain('document.addEventListener(\n      "wheel"');
    expect(router).toContain('target.closest("#app-content")');
    expect(router).toContain("content.scrollTop += event.deltaY * deltaScale;");
    expect(router).toMatch(/\{ passive: false \}/);
  });

  test("enables deliberate boundary swipes only for public phone navigation", () => {
    expect(router).toContain("createMobilePageSwipeRecognizer,");
    expect(router).toContain('from "./mobile-page-navigation.js";');
    expect(router).toContain("this.attachMobilePageSwipeNavigation();");
    expect(router).toMatch(
      /attachMobilePageSwipeNavigation\(\)\s*\{[\s\S]*?if \(this\.previewRoute\)\s*\{[\s\S]*?"touchstart"[\s\S]*?"touchend"[\s\S]*?"touchcancel"/
    );
    expect(router).toContain("!this.isMobileBreakpoint()");
    expect(router).toContain("canStartMobilePageSwipe");
    expect(router).toContain("canFinishMobilePageSwipe");
    expect(router).toContain("MOBILE_SWIPE_INTERACTIVE_SELECTOR");
    expect(router).toContain('document.querySelector("dialog[open]")');
    expect(router).toContain('"touchstart",\n      (event) => {');
    expect(router).toContain("{ passive: true, capture: true }");
    expect(router).toContain("remainingTouchCount: event.touches.length");
    expect(router).toContain('mobileNav?.classList.contains("active")');
    expect(router.match(/\{ passive: true \}/g)?.length).toBeGreaterThanOrEqual(
      2
    );
  });

  test("shows mobile-only boundary cues without replacing the menu", () => {
    expect(shell).toMatch(
      /class="mobile-page-cues" aria-hidden="true"[\s\S]*id="mobile-page-cue-previous"[\s\S]*id="mobile-page-cue-next"/
    );
    expect(shell).toContain('id="mobile-menu-toggle"');
    expect(router).toContain("getMobilePageBoundaryCues");
    expect(router).toContain("Swipe ${direction} for ${label}");
    expect(globalStyles).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.mobile-page-cue \{[\s\S]*?position: fixed;/
    );
  });

  test("scopes directional page animations to motion-safe phone styles", () => {
    expect(globalStyles).toContain(
      "@media (max-width: 480px) and (prefers-reduced-motion: no-preference)"
    );
    expect(globalStyles).toContain(".page-container.mobile-page-exit-next");
    expect(globalStyles).toContain(
      ".page-container.mobile-page-enter-previous"
    );
    expect(globalStyles).toContain("@media (prefers-reduced-motion: reduce)");
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

  test("shows the complete GitHub activity graph inline on phones", () => {
    expect(homeStyles).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.profile-section \{[^}]*flex-direction: column;[\s\S]*?\.stats,\s*\.github-activity \{[^}]*width: 100%;/
    );
    expect(homeStyles).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.github-activity__trigger \{[^}]*display: none;/
    );
    expect(homeStyles).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.github-activity__panel \{[^}]*height: auto;[^}]*opacity: 1;[^}]*position: static;[^}]*visibility: visible;[^}]*width: 100%;/
    );
    expect(homeStyles).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.github-activity__map-frame \{[^}]*overflow: hidden;[^}]*width: 100%;/
    );
    expect(homeStyles).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.github-activity__heatmap \{[^}]*height: auto;/
    );
  });
});
