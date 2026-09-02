import { describe, expect, test } from "bun:test";

const projectStyles = await Bun.file(
  import.meta.dir + "/projects/styles.css"
).text();

describe("project cards", () => {
  test("keep compact thumbnails at every layout size", () => {
    expect(projectStyles).toMatch(
      /\.project-image \{[^}]*width: 100px;[^}]*aspect-ratio: 8 \/ 5;/
    );
    expect(projectStyles).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.project-image \{[^}]*width: 80px;/
    );
    expect(projectStyles).not.toContain("min-height: 300px");
    expect(projectStyles).not.toContain("width: clamp(360px, 58%, 420px)");
  });

  test("enlarges image previews on hover and keyboard focus", () => {
    expect(projectStyles).toContain(
      ".project-image[data-previewable]:hover img"
    );
    expect(projectStyles).toContain(
      ".project-link:focus-visible .project-image[data-previewable] img"
    );
    expect(projectStyles).toContain(
      ".project-image[data-previewable]:hover .project-image__tooltip"
    );
    expect(projectStyles).toContain("transform: scale(2.35)");
  });

  test("locks every Project image surface to the 1440x900 ratio", () => {
    expect(projectStyles).toMatch(
      /\.project-media__slide--image \{[^}]*aspect-ratio: 8 \/ 5;/
    );
    expect(projectStyles).toMatch(
      /\.project-case-study__body img \{[^}]*aspect-ratio: 8 \/ 5;[^}]*object-fit: cover;/
    );
  });

  test("keeps technology badges exclusive to project articles", () => {
    expect(projectStyles).not.toContain(".project-technologies--card");
    expect(projectStyles).toContain(".project-technologies--article");
    expect(projectStyles).toMatch(
      /\.project-technologies li \{[^}]*border-radius: 4px;/
    );
    expect(projectStyles).toContain(".technology-badge__logo");
    expect(projectStyles).toContain("var(--technology-icon)");
  });
});
