import { describe, expect, test } from "bun:test";
import { aboutConfig } from "../config";

const questurianProject = Bun.file(
  "./src/content/projects/questurian/content.md",
);
const minimalPortfolioProject = Bun.file(
  "./src/content/projects/minimal-portfolio/content.md",
);
const profilePost = Bun.file(
  "./src/content/blog/who-is-alan-malpartida-software-engineer-and-founder.md",
);

describe("published portfolio content", () => {
  test("uses the Questurian name consistently", async () => {
    expect(aboutConfig.sections).toHaveProperty("questurian");
    expect(JSON.stringify(aboutConfig)).not.toContain("Questurin");
  });

  test("does not publish the known broken LinkedIn profile", async () => {
    expect(JSON.stringify(aboutConfig)).not.toContain("alanmalpartisdaaaa");
    expect(await profilePost.text()).not.toContain("alanmalpartisdaaaa");
  });

  test("does not present unsupported performance or impact numbers", async () => {
    expect(await questurianProject.text()).not.toMatch(
      /50,000|10,000|95% user satisfaction/,
    );
    expect(await minimalPortfolioProject.text()).not.toMatch(
      /200ms server startup|5ms navigation/,
    );
  });
});
