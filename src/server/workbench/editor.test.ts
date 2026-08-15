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
  data: DraftRecord["data"],
  attributes: Partial<
    Pick<DraftRecord, "slug" | "displayOrder" | "publishedAt">
  > = {}
): DraftRecord {
  return {
    id: attributes.slug ? `content:${attributes.slug}` : `singleton:${type}`,
    type,
    data,
    slug: attributes.slug ?? null,
    displayOrder: attributes.displayOrder ?? null,
    publishedAt: attributes.publishedAt ?? null,
    updatedAt: "2026-08-14T00:00:00.000Z",
    draftVersion: 1,
    publishFindings: [],
  };
}

describe("Content editor", () => {
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

  test("renders every Project field including ordered technologies and address", () => {
    const html = renderEditorPanel({
      status: "ready",
      media: [asset],
      draft: draft(
        "project",
        {
          title: "Questurian",
          summary: "A concise summary",
          card: { mediaAssetId: asset.id, alt: "Questurian screen" },
          kicker: "Selected work",
          role: "Founder",
          status: "Live",
          period: "2025–present",
          technologies: ["TypeScript", "SQLite"],
          liveUrl: "https://example.com",
          repositoryUrl: "https://github.com/example/project",
          accentColor: "#0b4fd4",
          bodyMarkdown: "## Context\n\nLong form copy.",
          seo: { title: null, description: null, sharingImage: null },
        },
        { slug: "questurian", displayOrder: 4 }
      ),
    });

    expect(html.match(/<fieldset>/g)).toHaveLength(3);
    for (const name of [
      "title",
      "summary",
      "card.mediaAssetId",
      "kicker",
      "role",
      "status",
      "period",
      "liveUrl",
      "repositoryUrl",
      "accentColor",
      "bodyMarkdown",
      "slug",
      "displayOrder",
      "seo.title",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('data-field="technologies[0]"');
    expect(html).toContain('data-list-action="up"');
    expect(html).toContain('data-list-action="down"');
    expect(html).toContain('id="add-technology"');
    expect(html).toContain('value="questurian"');
    expect(html).toContain('value="4"');
    expect(html).toContain('data-display-order="4"');
    expect(html).toContain("<h3>Questurian</h3>");
    expect(html).toContain('id="delete-content-dialog"');
    expect(html).toContain('aria-labelledby="delete-content-heading"');
    expect(html).toContain("Delete Project");
  });

  test("renders every Blog post field and escapes collection values", () => {
    const html = renderEditorPanel({
      status: "ready",
      media: [asset],
      draft: draft(
        "blog_post",
        {
          title: '"><script>alert(1)</script>',
          excerpt: "A short excerpt",
          bodyMarkdown: "## Article",
          sharingImage: { mediaAssetId: asset.id, alt: "Article preview" },
          seo: { title: "Search title", description: null, sharingImage: null },
        },
        { slug: "first-post", publishedAt: "2026-01-15" }
      ),
    });

    expect(html.match(/<fieldset>/g)).toHaveLength(3);
    for (const name of [
      "title",
      "excerpt",
      "bodyMarkdown",
      "sharingImage.mediaAssetId",
      "slug",
      "publishedAt",
      "seo.title",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-01-15"');
    expect(html).toContain('data-published-at="2026-01-15"');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
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
    expect(html).toContain(
      "Publishing unlocks after the database cutover is sealed"
    );
  });

  test("renders an explicit slug-confirmation form for new collection items", () => {
    const html = renderEditorPanel({ status: "create", type: "blog_post" });

    expect(html).toContain('id="collection-create"');
    expect(html).toContain('data-content-type="blog_post"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="slug"');
    expect(html).toContain("Leave empty to generate a suggestion");
    expect(html).toContain("Create Blog post");
    expect(html).not.toContain("delete-content-dialog");
  });
});
