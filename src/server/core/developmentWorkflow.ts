import { formatWorkflowStatus } from "../../shared/workflowPolicy";

export interface DevelopmentWorkflowState {
  branch: string;
  clean: boolean;
}

const decoder = new TextDecoder();

export function formatDevelopmentWorkflowBanner(
  state: DevelopmentWorkflowState
): string {
  const lines = formatWorkflowStatus(state);
  lines.push("[workflow] guide: WORKFLOW.md");
  return lines.join("\n");
}

export function readDevelopmentWorkflowState(): DevelopmentWorkflowState {
  const branchResult = Bun.spawnSync(["git", "branch", "--show-current"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const statusResult = Bun.spawnSync(["git", "status", "--porcelain"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    branch:
      branchResult.exitCode === 0
        ? decoder.decode(branchResult.stdout).trim()
        : "",
    clean:
      statusResult.exitCode === 0 &&
      decoder.decode(statusResult.stdout).trim() === "",
  };
}

export function logDevelopmentWorkflowBanner(
  environment = process.env.NODE_ENV
): void {
  if (environment === "production") return;
  console.log(formatDevelopmentWorkflowBanner(readDevelopmentWorkflowState()));
}
