import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const decoder = new TextDecoder();
const workflowScript = join(import.meta.dir, "workflow.ts");
const wizardScript = join(import.meta.dir, "workflow-wizard.sh");
const projectRoot = resolve(import.meta.dir, "..");
const temporaryDirectories: string[] = [];

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function run(
  command: string[],
  cwd: string,
  environment: Record<string, string | undefined> = process.env
): Result {
  const result = Bun.spawnSync(command, {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function mustRun(command: string[], cwd: string): Result {
  const result = run(command, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed:\n${result.stdout}\n${result.stderr}`
    );
  }
  return result;
}

async function writeFakeGitHub(
  fakeBin: string,
  pullRequest = {
    list: "[]",
    view: JSON.stringify({
      state: "MERGED",
      url: "https://example.invalid/pull/1",
      headRefOid: "",
    }),
  }
): Promise<void> {
  const script = `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  printf '%s\\n' '${pullRequest.list}'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\\n' '${pullRequest.view}'
  exit 0
fi
exit 1
`;
  const path = join(fakeBin, "gh");
  await writeFile(path, script);
  await chmod(path, 0o755);
}

async function createFixture(): Promise<{
  repository: string;
  fakeBin: string;
  environment: Record<string, string | undefined>;
}> {
  const root = await mkdtemp(join(tmpdir(), "portfolio-workflow-"));
  temporaryDirectories.push(root);
  const remote = join(root, "remote.git");
  const repository = join(root, "repository");
  const fakeBin = join(root, "bin");
  await mkdir(repository);
  await mkdir(fakeBin);

  mustRun(["git", "init", "--bare", remote], root);
  mustRun(["git", "init", "-b", "main"], repository);
  mustRun(["git", "config", "user.name", "Workflow Test"], repository);
  mustRun(
    ["git", "config", "user.email", "workflow@example.invalid"],
    repository
  );
  await writeFile(join(repository, "README.md"), "fixture\n");
  mustRun(["git", "add", "README.md"], repository);
  mustRun(["git", "commit", "-m", "Initial commit"], repository);
  mustRun(["git", "remote", "add", "origin", remote], repository);
  mustRun(["git", "push", "-u", "origin", "main"], repository);

  const environment = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
  };
  await writeFakeGitHub(fakeBin);

  return { repository, fakeBin, environment };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("workflow command integration", () => {
  test("refuses to reuse a branch name from an old pull request", async () => {
    const fixture = await createFixture();
    await writeFakeGitHub(fixture.fakeBin, {
      list: JSON.stringify([
        {
          state: "MERGED",
          url: "https://example.invalid/pull/older",
        },
      ]),
      view: "{}",
    });

    const start = run(
      [process.execPath, workflowScript, "start", "Repeated Name"],
      fixture.repository,
      fixture.environment
    );

    expect(start.exitCode).toBe(1);
    expect(start.stderr).toContain("used by an earlier pull request");
    expect(
      mustRun(
        ["git", "branch", "--show-current"],
        fixture.repository
      ).stdout.trim()
    ).toBe("main");
  });

  test("starts a feature, reports status, and catches a deleted secret file", async () => {
    const fixture = await createFixture();

    const start = run(
      [process.execPath, workflowScript, "start", "Test Change"],
      fixture.repository,
      fixture.environment
    );
    expect(start.exitCode).toBe(0);
    expect(
      mustRun(["git", "branch", "--show-current"], fixture.repository).stdout
    ).toContain("feature/test-change");

    const status = run(
      [process.execPath, workflowScript, "status"],
      fixture.repository,
      fixture.environment
    );
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("safe local work branch");

    await writeFile(
      join(fixture.repository, ".env.local"),
      "TEST_ONLY=value\n"
    );
    mustRun(["git", "add", ".env.local"], fixture.repository);
    mustRun(
      ["git", "commit", "-m", "Add accidental env file"],
      fixture.repository
    );
    await rm(join(fixture.repository, ".env.local"));
    mustRun(["git", "add", ".env.local"], fixture.repository);
    mustRun(
      ["git", "commit", "-m", "Delete accidental env file"],
      fixture.repository
    );

    const submit = run(
      [process.execPath, workflowScript, "submit"],
      fixture.repository,
      fixture.environment
    );
    expect(submit.exitCode).toBe(1);
    expect(submit.stderr).toContain(
      "Possible secret files detected: .env.local"
    );
    expect(
      run(
        ["git", "ls-remote", "--heads", "origin", "feature/test-change"],
        fixture.repository
      ).stdout
    ).toBe("");
  });

  test("finish preserves commits created after the merged PR head", async () => {
    const fixture = await createFixture();
    const start = run(
      [process.execPath, workflowScript, "start", "Safe Cleanup"],
      fixture.repository,
      fixture.environment
    );
    expect(start.exitCode).toBe(0);

    await writeFile(join(fixture.repository, "change.txt"), "merged change\n");
    mustRun(["git", "add", "change.txt"], fixture.repository);
    mustRun(["git", "commit", "-m", "Merged change"], fixture.repository);
    const pullRequestHead = mustRun(
      ["git", "rev-parse", "HEAD"],
      fixture.repository
    ).stdout.trim();
    await writeFakeGitHub(fixture.fakeBin, {
      list: "[]",
      view: JSON.stringify({
        state: "MERGED",
        url: "https://example.invalid/pull/1",
        headRefOid: pullRequestHead,
      }),
    });

    await writeFile(join(fixture.repository, "later.txt"), "must survive\n");
    mustRun(["git", "add", "later.txt"], fixture.repository);
    mustRun(["git", "commit", "-m", "Later local work"], fixture.repository);
    const currentHead = mustRun(
      ["git", "rev-parse", "HEAD"],
      fixture.repository
    ).stdout.trim();

    const finish = run(
      [process.execPath, workflowScript, "finish"],
      fixture.repository,
      fixture.environment
    );
    expect(finish.exitCode).toBe(1);
    expect(finish.stderr).toContain("commits made after");
    expect(
      mustRun(
        ["git", "branch", "--show-current"],
        fixture.repository
      ).stdout.trim()
    ).toBe("feature/safe-cleanup");
    expect(
      mustRun(["git", "rev-parse", "HEAD"], fixture.repository).stdout.trim()
    ).toBe(currentHead);
  });
});

describe("workflow support checks", () => {
  test("pre-push hook blocks any push targeting remote main", async () => {
    const fixture = await createFixture();
    const start = run(
      [process.execPath, workflowScript, "start", "Hook Test"],
      fixture.repository,
      fixture.environment
    );
    expect(start.exitCode).toBe(0);

    const hook = join(projectRoot, ".husky", "pre-push");
    const result = run(
      [
        "bash",
        "-c",
        'printf "%s\\n" "HEAD local-sha refs/heads/main remote-sha" | "$1"',
        "pre-push-test",
        hook,
      ],
      fixture.repository
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("never push directly to remote main");
  });

  test("guided wizard is valid shell and never invokes mutation helpers", async () => {
    expect(run(["bash", "-n", wizardScript], projectRoot).exitCode).toBe(0);

    const wizard = await readFile(wizardScript, "utf8");
    const marker = "# STAGES — author this section.";
    const stages = wizard.slice(wizard.indexOf(marker));
    expect(stages).not.toMatch(
      /^\s*(ask|ask_secret|write_env|set_secret|set_var)\s/m
    );
    expect(stages).toContain('elif [[ "$current_branch" == feature/* ]]; then');
    expect(stages).toContain("is not a managed feature branch");
  });

  test("production-only dependency installation succeeds without Husky", async () => {
    const root = await mkdtemp(join(tmpdir(), "portfolio-production-install-"));
    temporaryDirectories.push(root);
    await copyFile(
      join(projectRoot, "package.json"),
      join(root, "package.json")
    );
    await copyFile(join(projectRoot, "bun.lock"), join(root, "bun.lock"));

    const environment = {
      ...process.env,
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    };
    const install = run(
      [process.execPath, "install", "--frozen-lockfile", "--production"],
      root,
      environment
    );

    expect(install.exitCode).toBe(0);
  }, 60_000);
});
