import { describe, expect, spyOn, test } from "bun:test";
import {
  formatDevelopmentWorkflowBanner,
  logDevelopmentWorkflowBanner,
} from "./developmentWorkflow";

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
    expect(banner).toContain("do not push");
  });

  test("marks a feature branch safe for local work", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "feature/contact-page",
      clean: false,
    });

    expect(banner).toContain("safe local work branch");
    expect(banner).toContain("review, stage, and commit");
  });

  test("warns when Git is detached", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "",
      clean: true,
    });

    expect(banner).toContain("not currently on a named branch");
  });

  test("warns that unrecognized branches are not managed work branches", () => {
    const banner = formatDevelopmentWorkflowBanner({
      branch: "fix/contact-page",
      clean: true,
    });

    expect(banner).toContain("not a managed feature branch");
    expect(banner).toContain("do not submit");
  });

  test("prints nothing in production", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    logDevelopmentWorkflowBanner("production");

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
