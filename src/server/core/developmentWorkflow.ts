export interface DevelopmentWorkflowState {
  branch: string;
  clean: boolean;
}

const decoder = new TextDecoder();

export function formatDevelopmentWorkflowBanner(
  state: DevelopmentWorkflowState
): string {
  const lines = [`[workflow] branch: ${state.branch || "(detached)"}`];

  if (state.branch === "main" && state.clean) {
    lines.push("[workflow] main is protected — do not edit here.");
    lines.push("[workflow] next: bun run work:start");
  } else if (state.branch === "main") {
    lines.push("[workflow] WARNING: uncommitted work exists on main.");
    lines.push("[workflow] next: bun run work:status");
  } else if (!state.branch) {
    lines.push("[workflow] WARNING: Git is not on a named branch.");
    lines.push("[workflow] next: bun run work:status");
  } else {
    lines.push("[workflow] safe local work branch.");
    lines.push("[workflow] next: bun run work:status");
  }

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
