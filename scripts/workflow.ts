import { createInterface } from "node:readline/promises";
import {
  PRIMARY_BRANCH,
  formatWorkflowStatus,
  slugifyDescription,
  validateStartSafety,
  validateSubmitSafety,
} from "./workflow-lib";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  allowFailure?: boolean;
  capture?: boolean;
}

const decoder = new TextDecoder();
let repositoryRoot = process.cwd();

function run(command: string[], options: RunOptions = {}): CommandResult {
  const capture = options.capture ?? false;
  const result = Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  });
  const output: CommandResult = {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  };

  if (!options.allowFailure && output.exitCode !== 0) {
    const detail = output.stderr || output.stdout;
    throw new Error(
      `${command.join(" ")} failed${detail ? `: ${detail}` : ""}`
    );
  }

  return output;
}

function output(command: string[], allowFailure = false): CommandResult {
  return run(command, { allowFailure, capture: true });
}

function requireCommand(command: string): void {
  if (!Bun.which(command)) {
    throw new Error(
      `Required command "${command}" is missing. Install it before continuing.`
    );
  }
}

function initializeRepository(): void {
  requireCommand("git");
  const rootResult = output(["git", "rev-parse", "--show-toplevel"], true);
  if (rootResult.exitCode !== 0 || !rootResult.stdout) {
    throw new Error("Run this command inside the portfolio Git repository.");
  }

  repositoryRoot = rootResult.stdout;
  process.chdir(repositoryRoot);
}

function currentBranch(): string {
  return output(["git", "branch", "--show-current"]).stdout;
}

function worktreeIsClean(): boolean {
  return output(["git", "status", "--porcelain"]).stdout === "";
}

function mainCounts(): { ahead: number; behind: number } {
  const result = output([
    "git",
    "rev-list",
    "--left-right",
    "--count",
    `origin/${PRIMARY_BRANCH}...${PRIMARY_BRANCH}`,
  ]);
  const [behindText = "0", aheadText = "0"] = result.stdout.split(/\s+/);

  return {
    behind: Number.parseInt(behindText, 10),
    ahead: Number.parseInt(aheadText, 10),
  };
}

async function ask(question: string): Promise<string> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} [y/N] `);
  return /^y(es)?$/i.test(answer);
}

function printErrors(errors: string[]): never {
  for (const error of errors) {
    console.error(`[workflow] BLOCKED: ${error}`);
  }
  throw new Error("Workflow guardrail stopped this operation.");
}

async function start(descriptionParts: string[]): Promise<void> {
  const branch = currentBranch();
  const clean = worktreeIsClean();

  if (branch !== PRIMARY_BRANCH || !clean) {
    printErrors(
      validateStartSafety({
        branch,
        clean,
        mainAheadBy: 0,
        description: descriptionParts.join(" ") || "placeholder",
      })
    );
  }

  console.log("[workflow] checking GitHub main...");
  run(["git", "fetch", "origin", PRIMARY_BRANCH]);
  const counts = mainCounts();
  const description =
    descriptionParts.join(" ").trim() ||
    (await ask("Short change description: "));
  const errors = validateStartSafety({
    branch,
    clean,
    mainAheadBy: counts.ahead,
    description,
  });
  if (errors.length > 0) printErrors(errors);

  if (counts.behind > 0) {
    run(["git", "pull", "--ff-only", "origin", PRIMARY_BRANCH]);
  }

  const workBranch = `feature/${slugifyDescription(description)}`;
  const localBranch = output(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${workBranch}`],
    true
  );
  const remoteBranch = output(
    ["git", "ls-remote", "--exit-code", "--heads", "origin", workBranch],
    true
  );
  if (localBranch.exitCode === 0 || remoteBranch.exitCode === 0) {
    throw new Error(
      `Branch "${workBranch}" already exists. Choose another description.`
    );
  }

  run(["git", "switch", "-c", workBranch]);
  console.log(`[workflow] created ${workBranch}`);
  console.log("[workflow] next: bun run dev");
}

function status(): void {
  const branch = currentBranch();
  const clean = worktreeIsClean();

  for (const line of formatWorkflowStatus({ branch, clean })) {
    console.log(line);
  }
  console.log("[workflow] guide: WORKFLOW.md");
  console.log("");
  run(["git", "status", "--short", "--branch"]);
}

function requireGitHub(): void {
  requireCommand("gh");
  const auth = output(["gh", "auth", "status"], true);
  if (auth.exitCode !== 0) {
    throw new Error("GitHub CLI is not authenticated. Run: gh auth login");
  }
}

async function submit(): Promise<void> {
  const branch = currentBranch();
  const clean = worktreeIsClean();

  console.log("[workflow] comparing branch with GitHub main...");
  run(["git", "fetch", "origin", PRIMARY_BRANCH]);

  const changedPathsResult = output([
    "git",
    "diff",
    "--name-only",
    `origin/${PRIMARY_BRANCH}...HEAD`,
  ]);
  const changedPaths = changedPathsResult.stdout
    ? changedPathsResult.stdout.split("\n")
    : [];
  const commitCount = Number.parseInt(
    output(["git", "rev-list", "--count", `origin/${PRIMARY_BRANCH}..HEAD`])
      .stdout,
    10
  );
  const errors = validateSubmitSafety({
    branch,
    clean,
    commitCount,
    changedPaths,
  });
  if (errors.length > 0) printErrors(errors);

  console.log("");
  run(["git", "diff", "--stat", `origin/${PRIMARY_BRANCH}...HEAD`]);
  console.log("");
  if (!(await confirm("Run checks, push this branch, and open a draft PR?"))) {
    console.log("[workflow] cancelled; nothing pushed.");
    return;
  }

  run(["bun", "run", "check"]);
  requireGitHub();
  run(["git", "push", "-u", "origin", branch]);

  const existingPullRequest = output(
    ["gh", "pr", "view", branch, "--json", "url,state,isDraft"],
    true
  );
  let pullRequestUrl = "";

  if (existingPullRequest.exitCode === 0) {
    const pullRequest = JSON.parse(existingPullRequest.stdout) as {
      url: string;
    };
    pullRequestUrl = pullRequest.url;
    console.log("[workflow] existing PR found.");
  } else {
    pullRequestUrl = output([
      "gh",
      "pr",
      "create",
      "--draft",
      "--base",
      PRIMARY_BRANCH,
      "--head",
      branch,
      "--fill",
    ]).stdout;
  }

  console.log(`[workflow] PR: ${pullRequestUrl}`);
  console.log("[workflow] review Files changed; wait for green check.");
  console.log("[workflow] then mark Ready and use Squash and merge.");
  run(["gh", "pr", "view", branch, "--web"], { allowFailure: true });
}

async function finish(): Promise<void> {
  const branch = currentBranch();
  if (branch === PRIMARY_BRANCH || !branch) {
    throw new Error("Finish must run from a merged feature branch, not main.");
  }
  if (!worktreeIsClean()) {
    throw new Error(
      "Working tree is not clean. Commit or discard intended work first."
    );
  }

  requireGitHub();
  const pullRequestResult = output([
    "gh",
    "pr",
    "view",
    branch,
    "--json",
    "state,url",
  ]);
  const pullRequest = JSON.parse(pullRequestResult.stdout) as {
    state: string;
    url: string;
  };
  if (pullRequest.state !== "MERGED") {
    throw new Error(
      `PR is ${pullRequest.state}, not MERGED: ${pullRequest.url}`
    );
  }

  if (
    !(await confirm(
      `PR is merged. Sync main and delete local branch "${branch}"?`
    ))
  ) {
    console.log("[workflow] cancelled; no branch deleted.");
    return;
  }

  run(["git", "fetch", "--prune", "origin"]);
  run(["git", "switch", PRIMARY_BRANCH]);
  run(["git", "pull", "--ff-only", "origin", PRIMARY_BRANCH]);
  run(["git", "branch", "-D", branch]);

  console.log("[workflow] cleanup complete.");
  console.log("[workflow] next: bun run work:start");
}

function help(): void {
  console.log("Portfolio workflow commands:");
  console.log("  bun run work:start [description]");
  console.log("  bun run work:status");
  console.log("  bun run work:submit");
  console.log("  bun run work:finish");
  console.log("  bun run work:learn");
}

async function main(): Promise<void> {
  initializeRepository();
  const [command = "status", ...arguments_] = Bun.argv.slice(2);

  switch (command) {
    case "start":
      await start(arguments_);
      break;
    case "status":
      status();
      break;
    case "submit":
      await submit();
      break;
    case "finish":
      await finish();
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      throw new Error(`Unknown workflow command: ${command}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[workflow] ${message}`);
  process.exit(1);
});
