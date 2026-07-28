import { describe, expect, test } from "bun:test";
import {
  classifyBranch,
  formatWorkflowStatus,
  isSensitivePath,
  slugifyDescription,
  validateStartSafety,
  validateSubmitSafety,
} from "./workflow-lib";

describe("workflow guardrails", () => {
  test("creates safe branch slugs", () => {
    expect(slugifyDescription(" Add Contact Page! ")).toBe("add-contact-page");
    expect(slugifyDescription("!!!")).toBe("");
  });

  test("classifies main, work, and detached states", () => {
    expect(classifyBranch("main")).toBe("main");
    expect(classifyBranch("feature/contact-page")).toBe("work");
    expect(classifyBranch("")).toBe("detached");
  });

  test.each([
    [".env", true],
    [".env.local", true],
    ["config/credentials.json", true],
    ["certs/private.pem", true],
    [".env.example", false],
    ["src/config/index.ts", false],
  ])("classifies sensitive path %s", (path, expected) => {
    expect(isSensitivePath(path)).toBe(expected);
  });

  test("blocks unsafe start states", () => {
    expect(
      validateStartSafety({
        branch: "feature/existing",
        clean: false,
        mainAheadBy: 1,
        description: "",
      })
    ).toHaveLength(4);

    expect(
      validateStartSafety({
        branch: "main",
        clean: true,
        mainAheadBy: 0,
        description: "contact page",
      })
    ).toEqual([]);
  });

  test("blocks unsafe submissions", () => {
    expect(
      validateSubmitSafety({
        branch: "main",
        clean: false,
        commitCount: 0,
        changedPaths: [".env.local"],
      })
    ).toHaveLength(4);

    expect(
      validateSubmitSafety({
        branch: "feature/contact-page",
        clean: true,
        commitCount: 1,
        changedPaths: ["src/pages/contact.ts"],
      })
    ).toEqual([]);
  });

  test("explains next action from current state", () => {
    expect(formatWorkflowStatus({ branch: "main", clean: true })).toContain(
      "[workflow] next: bun run work:start"
    );
    expect(
      formatWorkflowStatus({
        branch: "feature/contact-page",
        clean: false,
      })
    ).toContain("[workflow] next: review, stage, and commit intended changes");
  });
});
