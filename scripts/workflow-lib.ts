export const PRIMARY_BRANCH = "main";

export type BranchKind = "main" | "work" | "detached";

export function slugifyDescription(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function classifyBranch(branch: string): BranchKind {
  if (!branch) return "detached";
  if (branch === PRIMARY_BRANCH) return "main";
  return "work";
}

export function isSensitivePath(path: string): boolean {
  const normalizedPath = path.toLowerCase().replaceAll("\\", "/");
  const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;

  if (fileName === ".env.example") return false;
  if (fileName === ".env" || fileName.startsWith(".env.")) return true;
  if (/\.(key|pem|p12|pfx)$/.test(fileName)) return true;

  return [
    "credentials.json",
    "service-account.json",
    "id_rsa",
    "id_ed25519",
  ].includes(fileName);
}

export interface StartSafetyInput {
  branch: string;
  clean: boolean;
  mainAheadBy: number;
  description: string;
}

export function validateStartSafety(input: StartSafetyInput): string[] {
  const errors: string[] = [];

  if (input.branch !== PRIMARY_BRANCH) {
    errors.push(
      `You are already on "${input.branch || "a detached commit"}". Run bun run work:status.`
    );
  }
  if (!input.clean) {
    errors.push(
      "Working tree has uncommitted changes. Run bun run work:status before starting new work."
    );
  }
  if (input.mainAheadBy > 0) {
    errors.push(
      "Local main contains commits not on GitHub. Move them to a feature branch before continuing."
    );
  }
  if (!slugifyDescription(input.description)) {
    errors.push(
      "Change description must contain at least one letter or number."
    );
  }

  return errors;
}

export interface SubmitSafetyInput {
  branch: string;
  clean: boolean;
  commitCount: number;
  changedPaths: string[];
}

export function validateSubmitSafety(input: SubmitSafetyInput): string[] {
  const errors: string[] = [];
  const branchKind = classifyBranch(input.branch);

  if (branchKind === "main") {
    errors.push("Submission blocked from main. Work from a feature branch.");
  }
  if (branchKind === "detached") {
    errors.push("Submission blocked from a detached commit.");
  }
  if (!input.clean) {
    errors.push(
      "Commit your intended changes before submission. Automatic staging is intentionally disabled."
    );
  }
  if (input.commitCount < 1) {
    errors.push("Feature branch has no commits that differ from main.");
  }

  const sensitivePaths = input.changedPaths.filter(isSensitivePath);
  if (sensitivePaths.length > 0) {
    errors.push(
      `Possible secret files detected: ${sensitivePaths.join(", ")}. Remove them from Git history before pushing.`
    );
  }

  return errors;
}

export interface WorkflowStatusInput {
  branch: string;
  clean: boolean;
}

export function formatWorkflowStatus(input: WorkflowStatusInput): string[] {
  const branchKind = classifyBranch(input.branch);
  const lines = [`[workflow] branch: ${input.branch || "(detached)"}`];

  if (branchKind === "main" && input.clean) {
    lines.push("[workflow] main is protected; start work on a feature branch.");
    lines.push("[workflow] next: bun run work:start");
    return lines;
  }

  if (branchKind === "main") {
    lines.push("[workflow] WARNING: uncommitted work exists on main.");
    lines.push("[workflow] do not push; run bun run work:status for recovery.");
    return lines;
  }

  if (branchKind === "detached") {
    lines.push("[workflow] WARNING: Git is not currently on a named branch.");
    lines.push("[workflow] next: bun run work:status");
    return lines;
  }

  lines.push("[workflow] safe local work branch.");
  lines.push(
    input.clean
      ? "[workflow] next: keep working or run bun run work:submit"
      : "[workflow] next: review, stage, and commit intended changes"
  );
  return lines;
}
