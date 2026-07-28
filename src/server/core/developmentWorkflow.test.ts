import { describe, expect, test } from "bun:test";
import { formatDevelopmentWorkflowBanner } from "./developmentWorkflow";

describe("development workflow banner", () => {
  test("warns developers not to edit clean main", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "main",
      clean: true,
    });

    expect(banner).toContain("main is protected");
    expect(banner).toContain("bun run work:start");
    expect(banner).toContain("WORKFLOW.md");
  });

  test("warns when uncommitted work exists on main", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "main",
      clean: false,
    });

    expect(banner).toContain("WARNING");
    expect(banner).toContain("bun run work:status");
  });

  test("marks a feature branch safe for local work", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "feature/contact-page",
      clean: false,
    });

    expect(banner).toContain("safe local work branch");
    expect(banner).toContain("bun run work:status");
  });

  test("warns when Git is detached", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "",
      clean: true,
    });

    expect(banner).toContain("not on a named branch");
  });
});
