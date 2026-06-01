#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SKILL = join(ROOT, "skills", "review-fix-ship");

function cleanup(root) {
  const absolute = resolve(root);
  const temporaryRoot = `${resolve(tmpdir())}${sep}`;
  assert.ok(absolute.startsWith(temporaryRoot), `Refusing to delete non-temporary path: ${absolute}`);
  rmSync(absolute, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${command} ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function reviewctl(script, args, env) {
  return JSON.parse(run(process.execPath, [script, ...args], { env }));
}

const temporary = mkdtempSync(join(tmpdir(), "review-fix-ship-installed-"));
try {
  const codexHome = join(temporary, "codex-home");
  const installedSkill = join(codexHome, "skills", "review-fix-ship");
  const script = join(installedSkill, "scripts", "reviewctl.mjs");
  const repo = join(temporary, "repo");
  const stateHome = join(temporary, "state");
  cpSync(SOURCE_SKILL, installedSkill, { recursive: true });
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-b", "main", repo]);
  run("git", ["-C", repo, "config", "user.name", "Review Fix Ship Smoke"]);
  run("git", ["-C", repo, "config", "user.email", "review-fix-ship-smoke@example.invalid"]);
  writeFileSync(join(repo, "README.md"), "# smoke\n", "utf8");
  run("git", ["-C", repo, "add", "README.md"]);
  run("git", ["-C", repo, "commit", "-m", "initial"]);

  const env = { ...process.env, CODEX_HOME: codexHome, REVIEW_FIX_SHIP_HOME: stateHome };
  const policy = reviewctl(script, ["tools", "policy", "--repo", repo], env);
  assert.equal(policy.executionPolicy.caveman.requestedMode, "lite");
  assert.equal(policy.executionPolicy.rtk.requestedMode, "explicit");
  reviewctl(script, ["scope", "normalize", "--repo", repo, "--run-id", "smoke", "--scope", "main"], env);
  const activated = reviewctl(script, ["efficiency", "activate", "--repo", repo, "--run-id", "smoke"], env);
  const status = reviewctl(script, ["efficiency", "status", "--repo", repo, "--run-id", "smoke"], env);
  assert.deepEqual(status.audit, activated.audit);
  assert.equal(status.policy.caveman.requestedMode, "lite");
  assert.equal(status.policy.rtk.requestedMode, "explicit");
  process.stdout.write("Fresh-install smoke passed\n");
} finally {
  cleanup(temporary);
}
