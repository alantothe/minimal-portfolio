import { describe, expect, test } from "bun:test";

const shell = await Bun.file(import.meta.dir + "/shell.html").text();
const router = await Bun.file(
  import.meta.dir + "/../public/spa-router.js"
).text();
const githubActivity = await Bun.file(
  import.meta.dir + "/../public/github-activity.js"
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
    expect(router).toContain("page: 'blog-post'");
    expect(router).toContain("page: 'project'");
  });

  test("supports pinning and dismissing the GitHub activity popover", () => {
    expect(imageLoader).toContain('import("/public/github-activity.js")');
    expect(githubActivity).toContain("attachGitHubActivityListener");
    expect(githubActivity).toContain('event.key === "Escape"');
    expect(githubActivity).toContain('"focusout"');
    expect(githubActivity).toContain("aria-expanded");
  });
});
