import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "../database/mediaRepository";
import type { DraftRecord } from "./contentDraft";
import { renderEditorPanel } from "./editor";

const asset: MediaAsset = {
  id: "media:portrait",
  provider: "cloudinary",
  providerAssetId: "provider-1",
  providerPublicId: "portfolio/portrait",
  providerVersion: "1",
  format: "jpg",
  bytes: 100,
  width: 100,
  height: 100,
  status: "ready",
  originalFilename: "portrait.jpg",
  altText: null,
  digest: null,
  createdAt: "2026-08-14T00:00:00.000Z",
};

function draft(
  type: DraftRecord["type"],
  data: DraftRecord["data"]
): DraftRecord {
  return {
    id: `singleton:${type}`,
    type,
    data,
    updatedAt: "2026-08-14T00:00:00.000Z",
    publishFindings: [],
  };
}

describe("singleton editor", () => {
  test("renders Home as Content, Media, and Metadata groups", () => {
    const html = renderEditorPanel({
      status: "ready",
      media: [asset],
      draft: draft("home", {
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        githubUsername: "ada",
        professionalTitle: "Programmer",
        introMarkdown: "Hello",
        bioMarkdown: "Biography",
        portrait: { mediaAssetId: asset.id, alt: "Ada at a desk" },
        seo: { title: null, description: null, sharingImage: null },
      }),
    });

    expect(html.match(/<fieldset>/g)).toHaveLength(3);
    for (const group of ["Content", "Media", "Metadata"]) {
      expect(html).toContain(`<legend>${group}</legend>`);
    }
    expect(html).toContain('name="displayName"');
    expect(html).toContain('aria-describedby="finding-displayName"');
    expect(html).toContain('id="finding-displayName"');
    expect(html).toContain('name="portrait.mediaAssetId"');
    expect(html).toContain(
      '<option value="media:portrait" selected>portrait.jpg</option>'
    );
    expect(html).toContain('name="seo.description"');
  });

  test("renders About social links as ordered structured rows", () => {
    const html = renderEditorPanel({
      status: "ready",
      media: [],
      draft: draft("about", {
        introMarkdown: "Intro",
        hobbiesMarkdown: "Hobbies",
        featuredTitle: "Featured",
        featuredBodyMarkdown: "Body",
        socialLinks: [{ label: "GitHub", url: "https://github.com/ada" }],
        seo: { title: null, description: null, sharingImage: null },
      }),
    });

    expect(html).toContain('id="social-links"');
    expect(html).toContain('data-field="socialLinks[0].label"');
    expect(html).toContain('data-field="socialLinks[0].url"');
    expect(html).toContain('aria-describedby="finding-social-label-0"');
    expect(html).toContain('id="add-social-link"');
    expect(html).toContain('id="social-link-template"');
    expect(html).toContain('data-social-action="up"');
    expect(html).toContain('data-social-action="down"');
    expect(html).toContain('data-social-action="remove"');
  });

  test("renders Branding media without inventing textual fields", () => {
    const html = renderEditorPanel({
      status: "ready",
      media: [asset],
      draft: draft("branding", {
        logo: null,
        defaultSharingImage: null,
      }),
    });

    expect(html).toContain('name="logo.mediaAssetId"');
    expect(html).toContain('name="defaultSharingImage.mediaAssetId"');
    expect(html).not.toContain('name="seo.title"');
  });

  test("escapes stored Content and renders autosave controls", () => {
    const html = renderEditorPanel({
      status: "ready",
      media: [],
      draft: draft("home", {
        displayName: '"><script>alert(1)</script>',
        email: "",
        githubUsername: "",
        professionalTitle: "",
        introMarkdown: "",
        bioMarkdown: "",
        portrait: null,
        seo: { title: null, description: null, sharingImage: null },
      }),
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('id="content-editor"');
    expect(html).toContain("Save now");
    expect(html).toContain("Publishing arrives in slice 8");
  });
});
