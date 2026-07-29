import { describe, expect, test } from "bun:test";
import {
  renderGitHubActivityPanel,
  type GitHubYearlyActivity,
} from "./githubActivity";

const activity: GitHubYearlyActivity = {
  totalContributions: 621,
  totalCommitContributions: 512,
  weeks: [
    [
      {
        count: 0,
        date: "2026-07-27",
        level: "NONE",
        weekday: 1,
      },
      {
        count: 7,
        date: "2026-07-28",
        level: "FOURTH_QUARTILE",
        weekday: 2,
      },
    ],
  ],
};

describe("GitHub activity panel", () => {
  test("renders yearly totals and an accessible daily heatmap", () => {
    const html = renderGitHubActivityPanel(activity, "alantothe");

    expect(html).toContain("621 contributions in the past year");
    expect(html).toContain("512 commits");
    expect(html).toContain('role="img"');
    expect(html).toContain(
      'aria-label="621 GitHub contributions in the past year"'
    );
    expect(html).toContain('data-level="FOURTH_QUARTILE"');
    expect(html).toContain("7 contributions on July 28, 2026");
    expect(html).toContain('href="https://github.com/alantothe"');
  });

  test("renders a useful fallback when GitHub is unavailable", () => {
    const html = renderGitHubActivityPanel(null, "alantothe");

    expect(html).toContain("Yearly activity unavailable");
    expect(html).not.toContain("<svg");
  });
});
