import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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

function createFakeTool(directory, name, { stdout = "fake", stderr = "", exitCode = 0 } = {}) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, process.platform === "win32" ? `${name}.CMD` : name);
  const content = process.platform === "win32"
    ? ["@echo off", stdout ? `echo ${stdout}` : "", stderr ? `echo ${stderr} 1>&2` : "", `exit /b ${exitCode}`, ""].join("\r\n")
    : ["#!/bin/sh", stdout ? `printf '%s\\n' '${stdout.replaceAll("'", "'\\''")}'` : "", stderr ? `printf '%s\\n' '${stderr.replaceAll("'", "'\\''")}' >&2` : "", `exit ${exitCode}`, ""].join("\n");
  writeFileSync(file, content, "utf8");
  if (process.platform !== "win32") chmodSync(file, 0o755);
  return file;
}

function envWithPathPrefix(directory, extra = {}) {
  const env = { ...process.env, ...extra };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = `${directory}${delimiter}${env[pathKey] || ""}`;
  return env;
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
    example: {
      scenario: "Read a key that is not present in the cache.",
      observed: "The request dereferences an absent entry and fails.",
      expected: "The request returns the configured fallback.",
    },
    recommendedFix: "Handle the absent entry before dereferencing it.",
    alternativeFix: "Return an explicit not-found result.",
    validation: ["Run the focused regression test."],
    ...overrides,
  };
}

function initializeArtifacts(repo, stateHome, runId, extra = []) {
  const preview = reviewctlJson([
    "artifacts", "init", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", runId,
    ...extra,
  ]);
  return reviewctlJson([
    "artifacts", "init", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", runId,
    ...extra,
    "--preview-token", preview.previewToken,
    "--confirm",
  ]);
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
  const env = envWithPathPrefix(bin, { CAVEMAN_SKILL_DIR: caveman });

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

test("tools doctor redacts auth failures and remote fetch caches readable provider artifacts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review fix ship ~ provider-"));
  t.after(() => cleanup(root));
  const stateHome = join(root, "state");

  const doctorRepo = createRepo(root, "doctor");
  const failingBin = join(root, "failing-bin");
  createFakeTool(failingBin, "gh", { stderr: "authentication failed for gho_SECRET123", exitCode: 1 });
  const failingEnv = envWithPathPrefix(failingBin);
  const doctor = reviewctlJson(["tools", "doctor", "--repo", doctorRepo, "--provider", "github"], { env: failingEnv });
  assert.equal(doctor.providers.github.available, true);
  assert.equal(doctor.providers.github.authenticated, false);
  assert.doesNotMatch(JSON.stringify(doctor), /gho_SECRET123/);
  assert.match(JSON.stringify(doctor), /redacted-github-token/);

  const repo = createRepo(root, "remote");
  git(["-C", repo, "remote", "add", "origin", "https://github.com/acme/project.git"]);
  const bin = join(root, "bin");
  createFakeTool(bin, "gh", { stdout: "fake provider output" });
  const env = envWithPathPrefix(bin);
  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "remote", "--scope", "https://github.com/acme/project/pull/7"]);
  initializeArtifacts(repo, stateHome, "remote");
  const fetched = reviewctlJson(["remote", "fetch", "--repo", repo, "--state-home", stateHome, "--run-id", "remote"], { env });
  assert.equal(fetched.localAnalysisAvailable, true);
  assert.equal(fetched.remoteReviews[0].status, "cached", JSON.stringify(fetched.remoteReviews[0]));
  assert.equal(existsSync(fetched.remoteReviews[0].metadataFile), true);
  assert.equal(existsSync(fetched.remoteReviews[0].patchFile), true);
  assert.equal(existsSync(join(repo, ".review-fix-ship", "runs", "remote", "remote", "github-7.patch")), true);
});

test("repository-local artifacts require approval, remain ignored, and expose readable reports", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-artifacts-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  writeJson(findings, [finding()]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "artifacts", "--scope", "main"]);
  reviewctlFails([
    "state", "record-findings",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "artifacts",
    "--file", findings,
  ], /Initialize repository-local artifacts/);
  const initialized = initializeArtifacts(repo, stateHome, "artifacts");
  assert.equal(initialized.ignoreUpdated, true);
  assert.match(readFileSync(join(repo, ".git", "info", "exclude"), "utf8"), /\.review-fix-ship\//);
  assert.equal(existsSync(join(repo, ".gitignore")), false);
  const repeated = initializeArtifacts(repo, stateHome, "artifacts");
  assert.equal(repeated.ignoreUpdated, false);

  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "artifacts", "--file", findings]);
  const artifactRoot = join(repo, ".review-fix-ship", "runs", "artifacts");
  assert.equal(existsSync(join(artifactRoot, "findings.md")), true);
  assert.equal(existsSync(join(artifactRoot, "findings", "RF-001.md")), true);
  const shown = reviewctlJson(["artifacts", "show", "--repo", repo, "--state-home", stateHome, "--run-id", "artifacts", "--finding-id", "RF-001"]);
  assert.match(shown.content, /## Example/);
  const listed = reviewctlJson(["artifacts", "list", "--repo", repo, "--state-home", stateHome, "--run-id", "artifacts"]);
  assert.ok(listed.roots[0].files.includes("findings/RF-001.md"));
  const latest = reviewctlJson(["state", "status", "--repo", repo, "--state-home", stateHome, "--latest"]);
  assert.equal(latest.run.id, "artifacts");
  reviewctlFails(["state", "status", "--repo", repo, "--state-home", stateHome, "--run-id", "artifacts", "--latest"], /either --run-id or --latest/);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "tracked-ignore", "--scope", "main"]);
  const trackedPreview = reviewctlJson(["artifacts", "init", "preview", "--repo", repo, "--state-home", stateHome, "--run-id", "tracked-ignore", "--track-ignore"]);
  assert.equal(existsSync(join(repo, ".gitignore")), false);
  reviewctlJson(["artifacts", "init", "run", "--repo", repo, "--state-home", stateHome, "--run-id", "tracked-ignore", "--track-ignore", "--preview-token", trackedPreview.previewToken, "--confirm"]);
  assert.match(readFileSync(join(repo, ".gitignore"), "utf8"), /\.review-fix-ship\//);
});

test("schema v2 rejects pre-release run state instead of migrating it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-schema-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");

  const version = reviewctlJson(["version"]);
  assert.equal(version.schemaVersion, 2);
  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "schema", "--scope", "main"]);
  const status = reviewctlJson(["state", "status", "--repo", repo, "--state-home", stateHome, "--run-id", "schema"]);
  const runFile = join(status.stateDirectory, "run.json");
  const run = JSON.parse(readFileSync(runFile, "utf8"));
  writeJson(runFile, { ...run, schemaVersion: 1 });
  reviewctlFails(["state", "status", "--repo", repo, "--state-home", stateHome, "--run-id", "schema"], /unsupported schema version/);
});

test("one run activates only one finding and can defer before continuing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-serial-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  writeJson(findings, [finding(), finding({ id: "RF-002", title: "Second issue" })]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--scope", "main"]);
  initializeArtifacts(repo, stateHome, "serial");
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--file", findings]);
  reviewctlFails(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--id", "RF-001", "--id", "RF-002"], /exactly one/);
  reviewctlJson(["state", "activate", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--id", "RF-001"]);
  reviewctlFails(["state", "activate", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--id", "RF-002"], /already active/);
  reviewctlJson(["state", "defer", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--finding-id", "RF-001", "--reason", "Handle later"]);
  reviewctlJson(["state", "activate", "--repo", repo, "--state-home", stateHome, "--run-id", "serial", "--id", "RF-002"]);
  const status = reviewctlJson(["state", "status", "--repo", repo, "--state-home", stateHome, "--run-id", "serial"]);
  assert.equal(status.activeFindingId, "RF-002");
  assert.deepEqual(status.deferredFindingIds, ["RF-001"]);
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

  const ambiguousRepo = createRepo(root, "ambiguous");
  git(["-C", ambiguousRepo, "branch", "src"]);
  reviewctlFails([
    "scope", "normalize",
    "--repo", ambiguousRepo,
    "--state-home", stateHome,
    "--run-id", "ambiguous-run",
    "--scope", "src",
  ], /Ambiguous scope: src; use ref:src or path:src/);
  const explicitRef = reviewctlJson([
    "scope", "normalize",
    "--repo", ambiguousRepo,
    "--state-home", stateHome,
    "--run-id", "explicit-ref-run",
    "--scope", "ref:src",
  ]);
  assert.deepEqual(explicitRef.scopes, [{ type: "revision", ref: "src" }]);
  const explicitPath = reviewctlJson([
    "scope", "normalize",
    "--repo", ambiguousRepo,
    "--state-home", stateHome,
    "--run-id", "explicit-path-run",
    "--scope", "path:src",
  ]);
  assert.deepEqual(explicitPath.scopes, [{ type: "directory", path: "src" }]);
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

test("workspace preview separates comparison start ref from change request target branch", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-workspace-refs-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  writeJson(findings, [finding()]);
  git(["-C", repo, "checkout", "-b", "feature"]);
  writeFileSync(join(repo, "src", "example.txt"), "feature\n", "utf8");
  git(["-C", repo, "add", "src/example.txt"]);
  git(["-C", repo, "commit", "-m", "feature"]);
  git(["-C", repo, "checkout", "main"]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "comparison", "--scope", "main...feature"]);
  initializeArtifacts(repo, stateHome, "comparison");
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "comparison", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "comparison", "--id", "RF-001"]);
  const preview = reviewctlJson([
    "workspace", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "comparison",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", join(root, "comparison-worktree"),
  ]);
  assert.equal(preview.workspace.startRef, "feature");
  assert.equal(preview.workspace.targetBranch, "main");
  assert.match(preview.command, / feature$/);

  const remoteRepo = createRepo(root, "remote-review");
  git(["-C", remoteRepo, "remote", "add", "origin", "https://github.com/acme/project.git"]);
  reviewctlJson(["scope", "normalize", "--repo", remoteRepo, "--state-home", stateHome, "--run-id", "remote-review", "--scope", "https://github.com/acme/project/pull/7"]);
  initializeArtifacts(remoteRepo, stateHome, "remote-review");
  reviewctlJson(["state", "record-findings", "--repo", remoteRepo, "--state-home", stateHome, "--run-id", "remote-review", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", remoteRepo, "--state-home", stateHome, "--run-id", "remote-review", "--id", "RF-001"]);
  reviewctlFails([
    "workspace", "preview",
    "--repo", remoteRepo,
    "--state-home", stateHome,
    "--run-id", "remote-review",
    "--finding-id", "RF-001",
    "--mode", "branch",
  ], /provide --start-ref and --target-branch/);
  const explicit = reviewctlJson([
    "workspace", "preview",
    "--repo", remoteRepo,
    "--state-home", stateHome,
    "--run-id", "remote-review",
    "--finding-id", "RF-001",
    "--mode", "branch",
    "--start-ref", "main",
    "--target-branch", "main",
  ]);
  assert.equal(explicit.workspace.startRef, "main");
  assert.equal(explicit.workspace.targetBranch, "main");
});

test("workspace creation refuses dirty repositories unless explicitly acknowledged", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-dirty-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  writeJson(findings, [finding()]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "dirty-run", "--scope", "main"]);
  initializeArtifacts(repo, stateHome, "dirty-run");
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

test("workspace creation requires a matching one-time preview token", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-preview-token-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  const approvedPath = join(root, "approved-worktree");
  const changedPath = join(root, "changed-worktree");
  writeJson(findings, [finding()]);

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "preview-token", "--scope", "main"]);
  initializeArtifacts(repo, stateHome, "preview-token");
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "preview-token", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "preview-token", "--id", "RF-001"]);
  reviewctlFails([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "preview-token",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", approvedPath,
    "--confirm",
  ], /preview-token/);
  const preview = reviewctlJson([
    "workspace", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "preview-token",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", approvedPath,
  ]);
  reviewctlFails([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "preview-token",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", changedPath,
    "--preview-token", preview.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  const matchingPreview = reviewctlJson([
    "workspace", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "preview-token",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", approvedPath,
  ]);
  reviewctlJson([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "preview-token",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", approvedPath,
    "--preview-token", matchingPreview.previewToken,
    "--confirm",
  ]);
  reviewctlFails([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "preview-token",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", approvedPath,
    "--preview-token", matchingPreview.previewToken,
    "--confirm",
  ], /already been consumed/);
});

test("push refuses commits added after the reviewed commit", (t) => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-ship-push-head-"));
  t.after(() => cleanup(root));
  const repo = createRepo(root);
  const stateHome = join(root, "state");
  const findings = join(root, "findings.json");
  const selfReview = join(root, "self-review.md");
  writeJson(findings, [finding()]);
  writeFileSync(selfReview, "# Self-review\n\nNo remaining issues.\n", "utf8");

  reviewctlJson(["scope", "normalize", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--scope", "main"]);
  initializeArtifacts(repo, stateHome, "push-head");
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--id", "RF-001"]);
  const workspacePreview = reviewctlJson([
    "workspace", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "push-head",
    "--finding-id", "RF-001",
    "--mode", "branch",
  ]);
  const workspace = reviewctlJson([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "push-head",
    "--finding-id", "RF-001",
    "--mode", "branch",
    "--preview-token", workspacePreview.previewToken,
    "--confirm",
  ]);
  git(["-C", repo, "checkout", workspace.workspace.branch]);
  reviewctlJson([
    "plan", "render",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "push-head",
    "--finding-id", "RF-001",
    "--title", "Handle missing cache entries",
    "--finding", "Absent entries are dereferenced.",
    "--step", "Add a guarded fallback.",
    "--test", "Run the focused regression test.",
  ]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--to", "plan_approved"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--to", "implementing"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--to", "self_reviewed", "--self-review-file", selfReview]);
  writeFileSync(join(repo, "src", "example.txt"), "initial\nfallback\n", "utf8");
  git(["-C", repo, "add", "src/example.txt"]);
  const commitPreview = reviewctlJson(["commit", "preview", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--message", "fix(cache): handle absent entries", "--file", "src/example.txt"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--to", "commit_pending"]);
  reviewctlJson(["commit", "run", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--message", "fix(cache): handle absent entries", "--file", "src/example.txt", "--preview-token", commitPreview.previewToken, "--confirm"]);
  writeFileSync(join(repo, "src", "example.txt"), "initial\nfallback\ndebug\n", "utf8");
  git(["-C", repo, "add", "src/example.txt"]);
  git(["-C", repo, "commit", "-m", "debug after review"]);

  reviewctlFails([
    "push", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "push-head",
    "--finding-id", "RF-001",
  ], /Workspace HEAD changed after the reviewed commit/);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "push-head", "--finding-id", "RF-001", "--to", "push_pending"]);
  reviewctlFails([
    "push", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "push-head",
    "--finding-id", "RF-001",
    "--confirm",
  ], /Workspace HEAD changed after the reviewed commit/);
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
  initializeArtifacts(repo, stateHome, "lifecycle");
  reviewctlJson(["state", "record-findings", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--file", findings]);
  reviewctlJson(["state", "select", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--id", "RF-001"]);

  const workspacePreview = reviewctlJson([
    "workspace", "preview",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", worktree,
  ]);
  reviewctlFails([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", worktree,
    "--preview-token", workspacePreview.previewToken,
  ], /requires explicit --confirm/);

  reviewctlJson([
    "workspace", "create",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--mode", "worktree",
    "--path", worktree,
    "--preview-token", workspacePreview.previewToken,
    "--confirm",
  ]);
  const mirroredWorkspace = join(worktree, ".review-fix-ship", "runs", "lifecycle");
  assert.equal(existsSync(join(mirroredWorkspace, "findings", "RF-001.md")), true);

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
  assert.match(readFileSync(join(mirroredWorkspace, "workspaces", "RF-001", "plan.md"), "utf8"), /## Example/);
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
  assert.equal(existsSync(join(mirroredWorkspace, "workspaces", "RF-001", "self-review.md")), true);

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
  assert.equal(existsSync(join(mirroredWorkspace, "workspaces", "RF-001", "change-request-github.md")), true);

  writeFileSync(join(worktree, "src", "example.txt"), "initial\nfallback\n", "utf8");
  rmSync(join(worktree, "src", "delete.txt"));
  git(["-C", worktree, "mv", "src/rename.txt", "src/renamed.txt"]);
  writeFileSync(join(worktree, "src", "file with space.txt"), "changed\n", "utf8");
  git(["-C", worktree, "add", "-u"]);
  git(["-C", worktree, "add", "src/example.txt"]);
  const commitPreview = reviewctlJson([
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
    "--message", "fix(cache): changed after preview",
    "--file", "src/delete.txt",
    "--file", "src/example.txt",
    "--file", "src/file with space.txt",
    "--file", "src/renamed.txt",
    "--preview-token", commitPreview.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  reviewctlFails([
    "commit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--message", "fix(cache): handle absent entries",
    "--file", "src/delete.txt",
    "--file", "src/example.txt",
    "--file", "src/file with space.txt",
    "--file", "src/renamed.txt",
    "--preview-token", commitPreview.previewToken,
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
    "--file", "src/delete.txt",
    "--file", "src/example.txt",
    "--file", "src/file with space.txt",
    "--file", "src/renamed.txt",
    "--preview-token", commitPreview.previewToken,
    "--confirm",
  ]);

  const pushPreview = reviewctlJson(["push", "preview", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001"]);
  reviewctlJson(["state", "mark", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--to", "push_pending"]);
  reviewctlFails([
    "push", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
  ], /requires explicit --confirm/);
  reviewctlFails([
    "push", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--remote", "changed-after-preview",
    "--preview-token", pushPreview.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  reviewctlJson(["push", "run", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--preview-token", pushPreview.previewToken, "--confirm"]);
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
  assert.match(submission.command, / --base main$/);
  assert.doesNotMatch(submission.command, /--dry-run/);
  assert.equal(typeof submission.adapterAvailable, "boolean");
  reviewctlFails([
    "submit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "github",
    "--title", "fix(cache): changed after preview",
    "--body-file", draft.bodyFile,
    "--preview-token", submission.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  reviewctlFails([
    "submit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "github",
    "--title", draft.title,
    "--body-file", draft.bodyFile,
    "--base", "changed-after-preview",
    "--preview-token", submission.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  reviewctlFails([
    "submit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "gitlab",
    "--title", draft.title,
    "--body-file", draft.bodyFile,
    "--preview-token", submission.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  const originalBody = readFileSync(draft.bodyFile, "utf8");
  writeFileSync(draft.bodyFile, `${originalBody}\nChanged after preview.\n`, "utf8");
  reviewctlFails([
    "submit", "run",
    "--repo", repo,
    "--state-home", stateHome,
    "--run-id", "lifecycle",
    "--finding-id", "RF-001",
    "--provider", "github",
    "--title", draft.title,
    "--body-file", draft.bodyFile,
    "--preview-token", submission.previewToken,
    "--confirm",
  ], /parameters changed after preview/);
  writeFileSync(draft.bodyFile, originalBody, "utf8");
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
  const finished = reviewctlJson(["state", "finish", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle", "--finding-id", "RF-001", "--outcome", "pushed"]);
  assert.equal(finished.findingStatus, "completed");
  const completedStatus = reviewctlJson(["state", "status", "--repo", repo, "--state-home", stateHome, "--run-id", "lifecycle"]);
  assert.equal(completedStatus.activeFindingId, null);
  assert.deepEqual(completedStatus.completedFindingIds, ["RF-001"]);
});
