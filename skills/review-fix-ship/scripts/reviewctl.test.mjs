import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "reviewctl.mjs");

function cleanup(root) {
  const absolute = resolve(root);
  const temporaryRoot = `${resolve(tmpdir())}${sep}`;
  assert.ok(absolute.startsWith(temporaryRoot), `Refusing to delete non-temporary path: ${absolute}`);
  rmSync(absolute, { recursive: true, force: true });
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    env: options.env || process.env,
  });
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function git(args, cwd = undefined) {
  const result = execute("git", args, { cwd });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

function reviewctl(args, expectedStatus = 0, options = {}) {
  const result = execute(process.execPath, [SCRIPT, ...args], options);
  assert.equal(
    result.status,
    expectedStatus,
    `Expected status ${expectedStatus}, received ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function reviewctlJson(args, options = {}) {
  return JSON.parse(reviewctl(args, 0, options).stdout);
}

function reviewctlFails(args, pattern) {
  const result = execute(process.execPath, [SCRIPT, ...args]);
  assert.notEqual(result.status, 0, `Expected failure\nstdout:\n${result.stdout}`);
  assert.match(result.stderr, pattern);
  return result;
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createRepo(root, name = "repo") {
  const repo = join(root, name);
  mkdirSync(join(repo, "src"), { recursive: true });
  git(["init", "-b", "main", repo]);
  git(["-C", repo, "config", "user.name", "Review Fix Ship Test"]);
  git(["-C", repo, "config", "user.email", "review-fix-ship@example.invalid"]);
  writeFileSync(join(repo, "src", "example.txt"), "initial\n", "utf8");
  git(["-C", repo, "add", "."]);
  git(["-C", repo, "commit", "-m", "initial"]);
  return repo;
}

function createFakeTool(directory, name) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, process.platform === "win32" ? `${name}.CMD` : name);
  writeFileSync(file, process.platform === "win32" ? "@echo off\r\necho fake\r\n" : "#!/bin/sh\necho fake\n", "utf8");
  if (process.platform !== "win32") chmodSync(file, 0o755);
  return file;
}

function assertSameDirectory(actualPath, expectedPath) {
  const actual = statSync(actualPath);
  const expected = statSync(expectedPath);
  assert.equal(actual.isDirectory(), true, `Expected directory: ${actualPath}`);
  assert.equal(expected.isDirectory(), true, `Expected directory: ${expectedPath}`);
  assert.equal(actual.dev, expected.dev);
  assert.equal(actual.ino, expected.ino);
}

function finding(overrides = {}) {
  return {
    id: "RF-001",
    title: "Handle missing cache entry",
    severity: "high",
    confidence: 94,
    valueScore: 89,
    evidence: [{ path: "src/example.txt", line: 1, detail: "The missing-entry path is not handled." }],
    trigger: "Read an absent cache key.",
    impact: "The request fails instead of returning a fallback.",
    recommendedFix: "Handle the absent entry before dereferencing it.",
    alternativeFix: "Return an explicit not-found result.",
    validation: ["Run the focused regression test."],
    ...overrides,
  };
}

test("preflight reports repository status and optional provider adapters", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-preflight-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);

  const output = reviewctlJson(["preflight", "--repo", repo]);
  assertSameDirectory(output.repository.root, repo);
  assert.equal(output.repository.dirty, false);
  assert.equal(typeof output.adapters.github.available, "boolean");
  assert.equal(typeof output.adapters.gitlab.available, "boolean");
  assert.equal(output.efficiency.platform.os, process.platform);
  assert.equal(typeof output.efficiency.tools.rtk.available, "boolean");
  assert.equal(typeof output.efficiency.tools.codegraph.available, "boolean");
});

test("tools status detects optional accelerators and CodeGraph index state", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-tools-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const bin = join(root, "bin");
  createFakeTool(bin, "rtk");
  createFakeTool(bin, "codegraph");
  const caveman = join(root, "caveman");
  mkdirSync(caveman, { recursive: true });
  writeFileSync(join(caveman, "SKILL.md"), "# caveman\n", "utf8");
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH || ""}`,
    CAVEMAN_SKILL_DIR: caveman,
  };

  const before = reviewctlJson(["tools", "status", "--repo", repo], { env });
  assert.equal(before.tools.caveman.available, true);
  assert.equal(before.tools.rtk.available, true);
  assert.equal(before.tools.codegraph.available, true);
  assert.equal(before.tools.codegraph.initialized, false);
  assert.match(before.recommendations.join("\n"), /Offer to run codegraph init -i/);

  mkdirSync(join(repo, ".codegraph"));
  const after = reviewctlJson(["tools", "status", "--repo", repo], { env });
  assert.equal(after.tools.codegraph.initialized, true);
  assert.match(after.recommendations.join("\n"), /Use CodeGraph directly/);
});

test("scope normalization deduplicates local scopes and accepts GitHub and self-hosted GitLab URLs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-scope-"));
  t.after(() => cleanup(root));
  const stateHome = join(root, "state");

  const localRepo = createRepo(root, "local");
  const local = reviewctlJson([
    "scope", "normalize",
    "--repo", localRepo,
    "--state-home", stateHome,
    "--run-id", "local-run",
    "--scope", "main",
    "--scope", "main",
    "--scope", "main...HEAD",
    "--scope", "src",
  ]);
  assert.equal(local.scopes.length, 3);
  assert.deepEqual(local.scopes.map((scope) => scope.type), ["revision", "comparison", "directory"]);
  const localState = reviewctlJson(["state", "status", "--repo", localRepo, "--state-home", stateHome, "--run-id", "local-run"]);
  assert.equal(localState.run.efficiency.platform.os, process.platform);

  const githubRepo = createRepo(root, "github");
  git(["-C", githubRepo, "remote", "add", "origin", "https://github.com/acme/project.git"]);
  const github = reviewctlJson([
    "scope", "normalize",
    "--repo", githubRepo,
    "--state-home", stateHome,
    "--run-id", "github-run",
    "--scope", "https://github.com/acme/project/pull/7",
  ]);
  assert.equal(github.scopes[0].provider, "github");
  assert.equal(github.scopes[0].number, 7);

  const gitlabRepo = createRepo(root, "gitlab");
  git(["-C", gitlabRepo, "remote", "add", "origin", "git@gitlab.example.com:team/group/project.git"]);
  const gitlab = reviewctlJson([
    "scope", "normalize",
    "--repo", gitlabRepo,
    "--state-home", stateHome,
    "--run-id", "gitlab-run",
    "--scope", "https://gitlab.example.com/team/group/project/-/merge_requests/12",
  ]);
  assert.equal(gitlab.scopes[0].provider, "gitlab");
  assert.equal(gitlab.scopes[0].number, 12);

  reviewctlFails([
    "scope", "normalize",
    "--repo", githubRepo,
    "--state-home", stateHome,
    "--run-id", "mismatch-run",
    "--scope", "https://github.com/other/project/pull/8",
  ], /does not match repository origin/);
});

test("finding recording rejects padding and low-confidence candidates", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-findings-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");

  reviewctlJson([
    "scope", "normalize",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "too-many",
    "--scope", "main",
  ]);
  const tooMany = join(root, "too-many.json");
  writeJson(tooMany, Array.from({ length: 6 }, (_, index) => finding({ id: `RF-00${index + 1}` })));
  reviewctlFails([
    "state", "record-findings",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "too-many",
    "--file", tooMany,
  ], /at most five/);

  reviewctlJson([
    "scope", "normalize",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "low-confidence",
    "--scope", "main",
  ]);
  const lowConfidence = join(root, "low-confidence.json");
  writeJson(lowConfidence, [finding({ confidence: 79 })]);
  reviewctlFails([
    "state", "record-findings",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "low-confidence",
    "--file", lowConfidence,
  ], /confidence must be between 80 and 100/);
});

test("workspace creation refuses dirty repositories unless explicitly acknowledged", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-dirty-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  writeJson(findings, [finding()]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "dirty-run", "--scope", "main"]);
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "dirty-run", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "dirty-run", "--id", "RF-001"]);
  writeFileSync(join(repo, "src", "example.txt"), "user change\n", "utf8");

  reviewctlFails([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "dirty-run",
    "--finding-id", "RF-001",
    "--mode", "branch",
    "--confirm",
  ], /uncommitted changes/);
});

test("full lifecycle enforces approval gates and renders external artifacts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-lifecycle-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const bareRemote = join(root, "remote.git");
  git(["init", "--bare", bareRemote]);
  git(["-C", repo, "remote", "add", "origin", bareRemote]);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  const worktree = join(root, "worktree");
  writeJson(findings, [finding()]);
  writeFileSync(join(repo, "src", "delete.txt"), "delete\n", "utf8");
  writeFileSync(join(repo, "src", "rename.txt"), "rename\n", "utf8");
  writeFileSync(join(repo, "src", "file with space.txt"), "initial\n", "utf8");
  git(["-C", repo, "add", "src/delete.txt", "src/rename.txt", "src/file with space.txt"]);
  git(["-C", repo, "commit", "-m", "add commit allowlist fixtures"]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--scope", "main"]);
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--id", "RF-001"]);

  reviewctlFails([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", worktree,
  ], /requires explicit --confirm/);

  reviewctlJson([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", worktree,
    "--confirm",
  ]);

  const plan = reviewctlJson([
    "plan", "render",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--title", "Handle missing cache entries",
    "--finding", "Absent entries are dereferenced.",
    "--step", "Add a guarded fallback.",
    "--file", "src/example.txt",
    "--test", "Run the focused regression test.",
    "--criterion", "The absent-entry path returns a fallback.",
  ]);
  assert.match(readFileSync(plan.planFile, "utf8"), /Approval status: `pending`/);
  const revisedPlan = reviewctlJson([
    "plan", "render",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--title", "Handle missing cache entries",
    "--finding", "Absent entries are dereferenced.",
    "--step", "Add a guarded fallback and preserve existing behavior.",
    "--file", "src/example.txt",
    "--test", "Run the focused regression test.",
    "--criterion", "The absent-entry path returns a fallback.",
  ]);
  assert.match(readFileSync(revisedPlan.planFile, "utf8"), /preserve existing behavior/);

  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--to", "plan_approved"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--to", "implementing"]);
  const selfReview = join(root, "self-review.md");
  writeFileSync(selfReview, "# Self-review\n\nNo remaining issues.\n", "utf8");
  reviewctlJson([
    "state", "mark",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--to", "self_reviewed",
    "--self-review-file", selfReview,
  ]);

  const draft = reviewctlJson([
    "draft", "render",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "github",
    "--title", "fix(cache): handle absent entries",
    "--summary", "Handle absent cache entries safely.",
    "--change", "Add an explicit fallback.",
    "--testing", "Run the focused regression test.",
  ]);
  assert.match(readFileSync(draft.bodyFile, "utf8"), /## Summary/);

  writeFileSync(join(worktree, "src", "example.txt"), "initial\nfallback\n", "utf8");
  rmSync(join(worktree, "src", "delete.txt"));
  git(["-C", worktree, "mv", "src/rename.txt", "src/renamed.txt"]);
  writeFileSync(join(worktree, "src", "file with space.txt"), "changed\n", "utf8");
  git(["-C", worktree, "add", "-u"]);
  git(["-C", worktree, "add", "src/example.txt"]);
  reviewctlJson([
    "commit", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--message", "fix(cache): handle absent entries",
    "--file", "src/delete.txt",
    "--file", "src/example.txt",
    "--file", "src/file with space.txt",
    "--file", "src/renamed.txt",
  ]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--to", "commit_pending"]);
  reviewctlFails([
    "commit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--message", "fix(cache): handle absent entries",
  ], /requires explicit --confirm/);
  const unrelated = join(worktree, "src", "unrelated file.txt");
  writeFileSync(unrelated, "unrelated\n", "utf8");
  git(["-C", worktree, "add", "src/unrelated file.txt"]);
  reviewctlFails([
    "commit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--message", "fix(cache): handle absent entries",
    "--confirm",
  ], /Staged files do not match the approved commit files/);
  git(["-C", worktree, "restore", "--staged", "src/unrelated file.txt"]);
  rmSync(unrelated);
  reviewctlJson([
    "commit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--message", "fix(cache): handle absent entries",
    "--confirm",
  ]);

  reviewctlJson(["push", "preview", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--to", "push_pending"]);
  reviewctlFails([
    "push", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
  ], /requires explicit --confirm/);
  reviewctlJson(["push", "run", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--confirm"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--to", "submit_pending"]);

  const submission = reviewctlJson([
    "submit", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "github",
    "--title", draft.title,
    "--body-file", draft.bodyFile,
  ]);
  assert.match(submission.command, /^gh pr create /);
  assert.doesNotMatch(submission.command, /--dry-run/);
  assert.equal(typeof submission.adapterAvailable, "boolean");
  reviewctlFails([
    "submit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "github",
    "--title", draft.title,
    "--body-file", draft.bodyFile,
  ], /requires explicit --confirm/);

  const status = reviewctlJson(["state", "status", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle"]);
  assert.equal(status.workspaces[0].phase, "submit_pending");
});
