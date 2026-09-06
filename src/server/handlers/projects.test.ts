import { describe, expect, test } from "bun:test";
import {
  renderProjectArticle,
  renderTechnologyBadges,
  type ProjectDetail,
} from "./projects";

function project(metadata: Record<string, unknown>): ProjectDetail {
  return {
    slug: "example",
    metadata: {
      title: "Example project",
      description: "A concise project description.",
      image: "/public/og.png",
      ...metadata,
    },
    html: "<h2>Context</h2><p>Project body.</p>",
  };
}

describe("Project article media", () => {
  test("renders local brand logos for technology badges", () => {
    const html = renderTechnologyBadges([
      "TypeScript",
      "HTML + CSS",
      "Vertex AI",
      "Private tool",
    ]);

    expect(html).toContain('data-brand="TypeScript"');
    expect(html).toContain('data-brand="HTML5"');
    expect(html).toContain('data-brand="CSS"');
    expect(html).toContain('data-brand="Google Cloud"');
    expect(html).toContain('class="technology-badge__logo-frame"');
    expect(html).toContain("technology-badge--unbranded");
    expect(html).toContain("Private tool");
    expect(html).not.toContain("cdn.simpleicons.org");
  });

  test("groups title, description, and technologies before media and body", () => {
    const html = renderProjectArticle(
      project({
        role: "Founding Engineer",
        status: "Active product",
        year: "2025–present",
        stack: ["Next.js", "TypeScript"],
        repository: "https://github.com/example/project",
      })
    );

    expect(html).toContain('class="project-article-header"');
    expect(html).not.toContain("project-hero");
    expect(html).toContain('src="/public/og.png"');
    expect(html).toContain('width="1440" height="900"');
    expect(html).toContain('aria-label="Project media"');
    expect(html).not.toContain("Founding Engineer");
    expect(html).not.toContain("2025–present");
    expect(html).not.toContain("Active product");
    expect(html).toContain('aria-label="Technologies used"');
    expect(html).toContain("Next.js");
    expect(html).toContain("TypeScript");
    expect(html).not.toContain("View repository");

    const title = html.indexOf("Example project");
    const description = html.indexOf("A concise project description.");
    const technologies = html.indexOf('aria-label="Technologies used"');
    const media = html.indexOf('aria-label="Project media"');
    const body = html.indexOf('class="project-case-study__body');
    expect(title).toBeLessThan(description);
    expect(description).toBeLessThan(technologies);
    expect(technologies).toBeLessThan(media);
    expect(media).toBeLessThan(body);
  });

  test("renders an automatic image carousel and a bounded native video", () => {
    const html = renderProjectArticle(
      project({
        gallery: [
          { src: "/public/one.webp", alt: "Overview" },
          { src: "/public/two.webp", alt: "Detail" },
        ],
        video: {
          src: "/public/demo.mp4",
          poster: "/public/poster.webp",
          caption: "Short product tour",
        },
      })
    );

    expect(html.match(/data-project-media-slide/g)).toHaveLength(4);
    expect(html).not.toContain('data-autoplay="true"');
    expect(html).toContain('width="1920" height="1080"');
    expect(html).toContain('poster="/public/poster.webp"');
    expect(html).toContain("Short product tour");
  });

  test("auto-advances image-only galleries", () => {
    const html = renderProjectArticle(
      project({ gallery: ["/public/one.webp", "/public/two.webp"] })
    );

    expect(html).toContain('data-autoplay="true"');
  });

  test("refuses untrusted media sources", () => {
    const html = renderProjectArticle(
      project({
        image: "https://evil.test/tracker.png",
        gallery: [{ src: "https://evil.test/slide.png", alt: "Bad" }],
        video: "https://evil.test/demo.mp4",
      })
    );

    expect(html).not.toContain("evil.test");
    expect(html).not.toContain('class="project-media');
  });

  test("escapes technology badge labels and supports legacy stack frontmatter", () => {
    const html = renderProjectArticle(
      project({ stack: ["Bun", '<img src=x onerror="alert(1)">'] })
    );

    expect(html).toContain("Bun");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
