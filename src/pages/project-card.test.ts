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

  test("keeps card thumbnails fixed while using the avatar-ring hover border", () => {
    expect(projectStyles).not.toContain("width 260ms");
    expect(projectStyles).not.toContain("width: clamp(220px, 38%, 300px)");
    expect(projectStyles).not.toContain("data-previewable");
    expect(projectStyles).not.toContain("project-image__tooltip");
    expect(projectStyles).toMatch(
      /\.project-card::before \{[^}]*padding: 1px;/
    );
    for (const stop of [
      "#6675e8 0deg",
      "#d98bcf 68deg",
      "#b9dfce 132deg",
      "#f1c33a 205deg",
      "#ff6b3f 286deg",
      "#6675e8 360deg",
    ]) {
      expect(projectStyles).toContain(stop);
    }
  });

  test("locks every Project image surface to the 1440x900 ratio", () => {
    expect(projectStyles).toMatch(
      /\.project-media__slide--image \{[^}]*aspect-ratio: 8 \/ 5;/
    );
    expect(projectStyles).toMatch(
      /\.project-case-study__body img \{[^}]*aspect-ratio: 8 \/ 5;[^}]*object-fit: cover;/
    );
  });

  test("stacks every article surface on one narrow-window reading edge", () => {
    expect(projectStyles).toMatch(
      /\.project-page-shell > \.back-link \{[^}]*width: min\(100%, 680px\);[^}]*margin-right: auto;[^}]*margin-left: auto;/
    );
    expect(projectStyles).toMatch(
      /\.project-article-header \{[^}]*var\(--project-article-measure\)/
    );
    expect(projectStyles).toMatch(
      /\.project-media \{[^}]*var\(--project-article-measure\)/
    );
    expect(projectStyles).toMatch(
      /\.project-case-study__body \{[^}]*var\(--project-article-measure\)/
    );
    expect(projectStyles).not.toContain("calc(100% + 24px)");
  });

  test("keeps technology badges exclusive to project articles", () => {
    expect(projectStyles).not.toContain(".project-technologies--card");
    expect(projectStyles).toContain(".project-technologies--article");
    expect(projectStyles).toMatch(
      /\.project-technologies li \{[^}]*border-radius: 999px;/
    );
    expect(projectStyles).toContain(".technology-badge__logo");
    expect(projectStyles).toMatch(
      /\.technology-badge__logo-frame \{[^}]*width: 16px;[^}]*height: 16px;/
    );
    expect(projectStyles).toMatch(
      /\.technology-badge__logo \{[^}]*width: 10px;[^}]*height: 10px;/
    );
    expect(projectStyles).toContain("var(--technology-icon)");
  });
});
