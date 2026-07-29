import { describe, expect, test } from "bun:test";

const homeContent = await Bun.file(
  import.meta.dir + "/home/content.html"
).text();
const homeStyles = await Bun.file(import.meta.dir + "/home/styles.css").text();
const imageLoader = await Bun.file(
  import.meta.dir + "/../public/image-loader.js"
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
});
