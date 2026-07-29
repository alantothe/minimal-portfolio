import { describe, expect, test } from "bun:test";

const homeContent = await Bun.file(
  import.meta.dir + "/home/content.html"
).text();
const homeStyles = await Bun.file(import.meta.dir + "/home/styles.css").text();
const imageLoader = await Bun.file(
  import.meta.dir + "/../public/image-loader.js"
).text();
const projectStyles = await Bun.file(
  import.meta.dir + "/projects/styles.css"
).text();

describe("profile image lightbox", () => {
  test("exposes the avatar as an accessible dialog trigger", () => {
    expect(homeContent).toContain("data-avatar-lightbox-trigger");
    expect(homeContent).toContain('aria-haspopup="dialog"');
    expect(homeContent).toContain('aria-controls="profile-image-lightbox"');
    expect(homeContent).toContain('id="profile-image-lightbox"');
    expect(homeContent).toContain("data-avatar-lightbox-close");
  });

  test("loads modal behavior and shows a pointer cursor", () => {
    expect(imageLoader).toContain('import("/public/avatar-lightbox.js")');
    expect(homeStyles).toMatch(
      /\.profile-image-trigger \{[^}]*cursor: pointer;/
    );
    expect(homeStyles).toContain(".avatar-lightbox::backdrop");
  });

  test("reuses the project-card orbit as an inset avatar ring without scaling", () => {
    expect(projectStyles).toContain("@keyframes project-border-orbit");
    expect(homeStyles).toContain("@keyframes profile-border-orbit");
    expect(homeStyles).toContain(".profile-image-trigger::after");
    expect(homeStyles).toContain("conic-gradient(");
    for (const stop of [
      "#6675e8 0deg",
      "#d98bcf 68deg",
      "#b9dfce 132deg",
      "#f1c33a 205deg",
      "#ff6b3f 286deg",
      "#6675e8 360deg",
    ]) {
      expect(homeStyles).toContain(stop);
    }
    expect(homeStyles).not.toContain("transform: scale(1.02)");
  });

  test("links avatar and GitHub activity hover states in both directions", () => {
    expect(homeStyles).toMatch(
      /\.profile-section:has\(\.profile-image-trigger:hover\)\s+\.github-activity__profile-text/
    );
    expect(homeStyles).toMatch(
      /\.profile-section:has\(\.profile-image-trigger:hover\)\s+\.github-activity\s+>\s+\.github-activity__panel/
    );
    expect(homeStyles).toMatch(
      /\.profile-section:has\(\s*\.github-activity:is\(:hover, :focus-within, \.is-open\)\s*\)/
    );
  });
});
