#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(SCRIPT_DIR);
const HELPER_VERSION = "2.0.0";
const SCHEMA_VERSION = 2;
const ARTIFACT_DIRECTORY = ".review-fix-ship";
const ARTIFACT_IGNORE_RULE = `${ARTIFACT_DIRECTORY}/`;
const WORKSPACE_PHASES = [
  "workspace_ready",
  "plan_ready",
  "plan_approved",
  "implementing",
  "self_reviewed",
  "commit_pending",
  "committed",
  "push_pending",
  "pushed",
  "submit_pending",
  "submitted",
];
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

class ReviewCtlError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "ReviewCtlError";
    this.details = details;
  }
}

function die(message, details = undefined) {
  throw new ReviewCtlError(message, details);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next !== undefined && !next.startsWith("--") ? argv[++index] : true;
    if (options[key] === undefined) {
      options[key] = value;
    } else if (Array.isArray(options[key])) {
      options[key].push(value);
    } else {
      options[key] = [options[key], value];
    }
  }

  return { options, positional };
}

function values(options, key) {
  const value = options[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function required(options, key) {
  const value = options[key];
  if (value === undefined || value === true || value === "") {
    die(`Missing required option --${key}`);
  }
  return String(Array.isArray(value) ? value.at(-1) : value);
}

function optional(options, key, fallback = undefined) {
  const value = options[key];
  if (value === undefined) return fallback;
  return String(Array.isArray(value) ? value.at(-1) : value);
}

function flag(options, key) {
  return options[key] === true || options[key] === "true";
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function requireSchema(value, label) {
  if (value.schemaVersion !== SCHEMA_VERSION) {
    die(`${label} uses unsupported schema version`, {
      expected: SCHEMA_VERSION,
      actual: value.schemaVersion ?? null,
      hint: "Create a new run with scope normalize. Pre-release schemas are intentionally not migrated.",
    });
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

function writeText(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function sanitizeOutput(value) {
  return String(value || "")
    .replace(/gh[opsu]_[A-Za-z0-9_]+/g, "<redacted-github-token>")
    .replace(/glpat-[A-Za-z0-9_-]+/g, "<redacted-gitlab-token>")
    .replace(/(https?:\/\/)[^/@\s]+@/g, "$1<redacted>@");
}

function windowsCommandQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=\\-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function run(command, args, { cwd = undefined, allowFailure = false } = {}) {
  const useCommandShim = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
  const executable = useCommandShim ? (process.env.ComSpec || "cmd.exe") : command;
  const executableArgs = useCommandShim
    ? ["/d", "/s", "/c", [command, ...args].map(windowsCommandQuote).join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error && !allowFailure) {
    die(`Failed to execute ${command}`, { error: result.error.message });
  }

  if ((result.status ?? 1) !== 0 && !allowFailure) {
    die(`Command failed: ${formatCommand(command, args)}`, {
      exitCode: result.status,
      stderr: sanitizeOutput((result.stderr || "").trim()),
      stdout: sanitizeOutput((result.stdout || "").trim()),
    });
  }

  return {
    ok: !result.error && result.status === 0,
    error: result.error?.message || null,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function runGit(repo, args, options = {}) {
  return run("git", ["-C", repo, ...args], options);
}

function findCommand(command) {
  const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  const directories = hasPathSeparator
    ? [""]
    : (process.env.PATH || "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" && !extname(command)
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = hasPathSeparator
        ? resolve(command)
        : join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, mode);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }

  return null;
}

function commandExists(command) {
  return findCommand(command) !== null;
}

function commandVersion(command) {
  const executable = findCommand(command);
  if (!executable) return null;
  const result = run(executable, ["--version"], { allowFailure: true });
  if (!result.ok) return null;
  return (result.stdout || result.stderr).split(/\r?\n/)[0] || null;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}

function normalizePathForHash(value) {
  const normalized = resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stateHome(options) {
  const configured = optional(options, "state-home") || process.env.REVIEW_FIX_SHIP_HOME;
  if (configured) return resolve(configured);

  const codexHome = process.env.CODEX_HOME
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");
  return join(codexHome, "review-fix-ship");
}

function repositoryInfo(repoInput) {
  const candidate = resolve(repoInput);
  const topLevel = runGit(candidate, ["rev-parse", "--show-toplevel"]).stdout;
  const common = runGit(topLevel, ["rev-parse", "--git-common-dir"]).stdout;
  const commonDir = isAbsolute(common) ? resolve(common) : resolve(topLevel, common);
  const origin = runGit(topLevel, ["config", "--get", "remote.origin.url"], {
    allowFailure: true,
  }).stdout;
  const branch = runGit(topLevel, ["branch", "--show-current"], {
    allowFailure: true,
  }).stdout;
  const dirtyLines = runGit(topLevel, ["status", "--porcelain"]).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  const submoduleLines = existsSync(join(topLevel, ".gitmodules"))
    ? runGit(topLevel, ["submodule", "status", "--recursive"], {
        allowFailure: true,
      }).stdout.split(/\r?\n/).filter(Boolean)
    : [];

  return {
    root: topLevel,
    commonDir,
    fingerprint: shortHash(normalizePathForHash(commonDir)),
    origin: origin ? sanitizeOutput(origin) : null,
    branch: branch || null,
    dirty: dirtyLines.length > 0,
    dirtyFiles: dirtyLines,
    submodules: submoduleLines,
  };
}

function cavemanStatus(repo) {
  const configured = process.env.CAVEMAN_SKILL_DIR;
  const candidates = [
    configured ? resolve(configured, "SKILL.md") : null,
    join(homedir(), ".codex", "skills", "caveman", "SKILL.md"),
    join(homedir(), ".agents", "skills", "caveman", "SKILL.md"),
    join(homedir(), ".claude", "skills", "caveman", "SKILL.md"),
    join(repo.root, ".agents", "skills", "caveman", "SKILL.md"),
  ].filter(Boolean);
  const detectedPaths = candidates.filter((candidate) => existsSync(candidate));

  return {
    available: detectedPaths.length > 0,
    type: "agent-skill",
    detectedPaths,
    usage: "Use concise response mode for progress and results while preserving evidence, approval prompts, and required artifacts.",
    installUrl: "https://github.com/JuliusBrussee/caveman",
  };
}

function efficiencyTools(repo) {
  const rtkPath = findCommand("rtk");
  const codegraphPath = findCommand("codegraph");
  const codegraphIndex = join(repo.root, ".codegraph");
  const tools = {
    caveman: cavemanStatus(repo),
    rtk: {
      available: Boolean(rtkPath),
      type: "cli-output-filter",
      commandPath: rtkPath,
      version: rtkPath ? commandVersion("rtk") : null,
      usage: "Prefer explicit rtk wrappers for exploratory shell reads, diffs, searches, tests, builds, and lint output. Keep reviewctl state operations raw and deterministic.",
      installUrl: "https://github.com/rtk-ai/rtk",
    },
    codegraph: {
      available: Boolean(codegraphPath),
      type: "local-code-index",
      commandPath: codegraphPath,
      version: codegraphPath ? commandVersion("codegraph") : null,
      initialized: existsSync(codegraphIndex),
      indexPath: codegraphIndex,
      usage: "Prefer CodeGraph MCP tools or CLI context, callers, callees, impact, and affected queries for structural exploration. Ask before creating a new .codegraph index.",
      installUrl: "https://github.com/colbymchenry/codegraph",
    },
  };

  const recommendations = [];
  if (tools.caveman.available) recommendations.push("Activate caveman concise mode for user-facing progress and final summaries.");
  if (tools.rtk.available) recommendations.push("Use rtk explicitly for high-volume exploratory shell output.");
  if (tools.codegraph.available && tools.codegraph.initialized) {
    recommendations.push("Use CodeGraph directly for structural exploration and impact analysis.");
  } else if (tools.codegraph.available) {
    recommendations.push("Offer to run codegraph init -i before structural exploration; it creates a local .codegraph index.");
  }

  return {
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
    },
    tools,
    recommendations,
  };
}

function repoStateDir(repo, options) {
  return join(stateHome(options), "repos", repo.fingerprint);
}

function runDir(repo, options, runId) {
  return join(repoStateDir(repo, options), "runs", runId);
}

function runFile(repo, options, runId) {
  return join(runDir(repo, options, runId), "run.json");
}

function latestRunId(repo, options) {
  const directory = join(repoStateDir(repo, options), "runs");
  if (!existsSync(directory)) die("No runs found for repository");
  const runIds = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (runIds.length === 0) die("No runs found for repository");
  return runIds.at(-1);
}

function loadRun(repo, options, runId) {
  const file = runFile(repo, options, runId);
  if (!existsSync(file)) die(`Run not found: ${runId}`, { file });
  const data = readJson(file);
  requireSchema(data, `Run ${runId}`);
  return { file, dir: dirname(file), data };
}

function saveRun(runContext) {
  runContext.data.updatedAt = new Date().toISOString();
  writeJson(runContext.file, runContext.data);
  if (runContext.data.artifacts?.initialized) {
    for (const root of artifactRoots(runContext)) writeJson(join(root, "run.json"), runContext.data);
  }
}

function workspaceFile(runContext, findingId) {
  return join(runContext.dir, "workspaces", `${findingId}.json`);
}

function loadWorkspace(runContext, findingId) {
  const file = workspaceFile(runContext, findingId);
  if (!existsSync(file)) die(`Workspace not found for finding: ${findingId}`, { file });
  const data = readJson(file);
  requireSchema(data, `Workspace ${findingId}`);
  return { file, data };
}

function saveWorkspace(workspaceContext) {
  workspaceContext.data.updatedAt = new Date().toISOString();
  writeJson(workspaceContext.file, workspaceContext.data);
}

function previewFile(runContext, findingId, action) {
  return join(runContext.dir, "previews", `${findingId}-${action}.json`);
}

function recordPreview(runContext, findingId, action, spec) {
  const token = randomBytes(16).toString("hex");
  writeJson(previewFile(runContext, findingId, action), {
    schemaVersion: SCHEMA_VERSION,
    findingId,
    action,
    token,
    spec,
    createdAt: new Date().toISOString(),
  });
  return token;
}

function verifyPreview(runContext, findingId, action, spec, options) {
  const token = required(options, "preview-token");
  const file = previewFile(runContext, findingId, action);
  if (!existsSync(file)) die(`${action} requires a matching preview`);
  const preview = readJson(file);
  if (preview.consumedAt) die(`${action} preview token has already been consumed`);
  if (preview.token !== token) die(`${action} preview token does not match the latest preview`);
  if (JSON.stringify(preview.spec) !== JSON.stringify(spec)) {
    die(`${action} parameters changed after preview`, {
      approved: preview.spec,
      actual: spec,
    });
  }
  return { file, data: preview };
}

function consumePreview(previewContext) {
  previewContext.data.consumedAt = new Date().toISOString();
  writeJson(previewContext.file, previewContext.data);
}

function artifactSourceRoot(repo, runId) {
  return join(repo.root, ARTIFACT_DIRECTORY, "runs", runId);
}

function ensureArtifactsInitialized(runContext) {
  if (!runContext.data.artifacts?.initialized) {
    die("Initialize repository-local artifacts before recording findings", {
      hint: "Run artifacts init preview, review the target paths, then run artifacts init run --preview-token <token> --confirm.",
    });
  }
  return runContext.data.artifacts;
}

function artifactRoots(runContext) {
  const artifacts = ensureArtifactsInitialized(runContext);
  return [...new Set([
    artifacts.sourceRoot,
    ...Object.values(artifacts.workspaceRoots || {}),
  ])];
}

function writeArtifactText(runContext, relativePath, content) {
  for (const root of artifactRoots(runContext)) writeText(join(root, relativePath), content);
}

function writeArtifactJson(runContext, relativePath, value) {
  for (const root of artifactRoots(runContext)) writeJson(join(root, relativePath), value);
}

function findingMarkdown(finding) {
  return `# ${finding.id}: ${finding.title}

## Summary
- Severity: \`${finding.severity}\`
- Confidence: \`${finding.confidence}\`
- Value score: \`${finding.valueScore}\`

## Evidence
${finding.evidence.map((item) => `- \`${item.path}${item.line ? `:${item.line}` : ""}\`: ${item.detail}`).join("\n")}

## Trigger
${finding.trigger}

## Impact
${finding.impact}

## Example
- Scenario: ${finding.example.scenario}
- Observed: ${finding.example.observed}
- Expected: ${finding.example.expected}

## Recommended Fix
${finding.recommendedFix}

## Alternative Fix
${finding.alternativeFix || "None specified."}

## Validation
${listText(finding.validation)}
`;
}

function writeFindingsArtifacts(runContext, findings) {
  const summary = `# Review Findings

| ID | Severity | Confidence | Value | Title |
| --- | --- | ---: | ---: | --- |
${findings.map((finding) => `| ${finding.id} | ${finding.severity} | ${finding.confidence} | ${finding.valueScore} | ${finding.title} |`).join("\n")}
`;
  writeArtifactText(runContext, "findings.md", summary);
  writeArtifactJson(runContext, "findings.json", findings);
  for (const finding of findings) writeArtifactText(runContext, join("findings", `${finding.id}.md`), findingMarkdown(finding));
}

function artifactInitSpec(repo, runContext, options) {
  const trackIgnore = flag(options, "track-ignore");
  return {
    artifactRoot: artifactSourceRoot(repo, runContext.data.id),
    ignoreFile: trackIgnore ? join(repo.root, ".gitignore") : join(repo.commonDir, "info", "exclude"),
    ignoreRule: ARTIFACT_IGNORE_RULE,
    trackIgnore,
  };
}

function ensureIgnoreRule(file, rule) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  if (lines.includes(rule)) return false;
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
  writeText(file, `${prefix}${rule}`);
  return true;
}

function mirrorArtifactsToWorkspace(runContext, findingId, workspacePath) {
  const artifacts = ensureArtifactsInitialized(runContext);
  const target = join(workspacePath, ARTIFACT_DIRECTORY, "runs", runContext.data.id);
  if (resolve(target) !== resolve(artifacts.sourceRoot)) {
    cpSync(artifacts.sourceRoot, target, { recursive: true, force: true });
  }
  artifacts.workspaceRoots ||= {};
  artifacts.workspaceRoots[findingId] = target;
  saveRun(runContext);
  return target;
}

function artifactFiles(root, prefix = "") {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = join(prefix, entry.name);
    return entry.isDirectory() ? artifactFiles(join(root, entry.name), child) : [child.replaceAll("\\", "/")];
  });
}

function nextRunId() {
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
  return `${timestamp}-${randomBytes(3).toString("hex")}`;
}

function normalizeOrigin(origin) {
  if (!origin) return null;
  let host = null;
  let repoPath = null;

  if (/^[^@]+@[^:]+:.+$/.test(origin)) {
    const match = origin.match(/^[^@]+@([^:]+):(.+)$/);
    host = match[1];
    repoPath = match[2];
  } else {
    try {
      const url = new URL(origin);
      host = url.hostname;
      repoPath = url.pathname.slice(1);
    } catch {
      return null;
    }
  }

  return {
    host: host.toLowerCase(),
    repoPath: repoPath.replace(/\.git$/i, "").replace(/^\/|\/$/g, "").toLowerCase(),
  };
}

function parseRemoteReviewUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) return null;
  url.username = "";
  url.password = "";

  const github = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (github) {
    return {
      type: "remote-review",
      provider: "github",
      host: url.hostname.toLowerCase(),
      repoPath: `${github[1]}/${github[2]}`.toLowerCase(),
      number: Number(github[3]),
      url: url.toString(),
    };
  }

  const gitlab = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)(?:\/|$)/);
  if (gitlab) {
    return {
      type: "remote-review",
      provider: "gitlab",
      host: url.hostname.toLowerCase(),
      repoPath: gitlab[1].toLowerCase(),
      number: Number(gitlab[2]),
      url: url.toString(),
    };
  }

  return null;
}

function validateRemoteMatchesOrigin(remote, origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return;
  if (
    remote.host !== normalizedOrigin.host ||
    remote.repoPath !== normalizedOrigin.repoPath
  ) {
    die("Remote review URL does not match repository origin", {
      reviewUrl: remote.url,
      expected: normalizedOrigin,
      actual: { host: remote.host, repoPath: remote.repoPath },
    });
  }
}

function commitishExists(repo, value) {
  return runGit(repo, ["rev-parse", "--verify", "--quiet", `${value}^{commit}`], {
    allowFailure: true,
  }).ok;
}

function normalizePathScope(repo, input) {
  const candidate = resolve(repo.root, input);
  const relativePath = relative(repo.root, candidate);
  const insideRepo = relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  if (!insideRepo || !existsSync(candidate)) return null;

  return {
    type: statSync(candidate).isDirectory() ? "directory" : "file",
    path: relativePath === "" ? "." : relativePath.replaceAll("\\", "/"),
  };
}

function normalizeScope(repo, input) {
  const remote = parseRemoteReviewUrl(input);
  if (remote) {
    validateRemoteMatchesOrigin(remote, repo.origin);
    return remote;
  }

  if (/^https?:\/\//i.test(input)) {
    die(`Unsupported remote review URL: ${input}`);
  }

  if (input.startsWith("ref:")) {
    const ref = input.slice("ref:".length);
    if (!ref || !commitishExists(repo.root, ref)) die(`Invalid revision scope: ${input}`);
    return { type: "revision", ref };
  }

  if (input.startsWith("path:")) {
    const path = input.slice("path:".length);
    const scope = path ? normalizePathScope(repo, path) : null;
    if (!scope) die(`Unsupported or missing path scope: ${input}`);
    return scope;
  }

  const comparison = input.match(/^(.+)\.\.\.(.+)$/);
  if (comparison) {
    const [, base, head] = comparison;
    if (!commitishExists(repo.root, base) || !commitishExists(repo.root, head)) {
      die(`Invalid comparison scope: ${input}`);
    }
    return { type: "comparison", base, head };
  }

  const pathScope = normalizePathScope(repo, input);
  const isRevision = commitishExists(repo.root, input);
  if (pathScope && isRevision) die(`Ambiguous scope: ${input}; use ref:${input} or path:${input}`);
  if (pathScope) return pathScope;
  if (isRevision) return { type: "revision", ref: input };

  die(`Unsupported or missing scope: ${input}`);
}

function uniqueScopes(scopes) {
  const seen = new Set();
  return scopes.filter((scope) => {
    const key = JSON.stringify(scope);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requireRunPhase(runContext, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(runContext.data.phase)) {
    die(`Run phase must be ${allowed.join(" or ")}`, {
      actual: runContext.data.phase,
    });
  }
}

function phaseAtLeast(actual, expected) {
  return WORKSPACE_PHASES.indexOf(actual) >= WORKSPACE_PHASES.indexOf(expected);
}

function requireWorkspacePhase(workspaceContext, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(workspaceContext.data.phase)) {
    die(`Workspace phase must be ${allowed.join(" or ")}`, {
      actual: workspaceContext.data.phase,
    });
  }
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "fix";
}

function findingById(runContext, findingId) {
  const file = join(runContext.dir, "findings.json");
  if (!existsSync(file)) die("Findings have not been recorded");
  const finding = readJson(file).find((item) => item.id === findingId);
  if (!finding) die(`Finding not found: ${findingId}`);
  return finding;
}

function ensureActive(runContext, findingId) {
  if (runContext.data.activeFindingId !== findingId) {
    die(`Finding is not active: ${findingId}`, {
      activeFindingId: runContext.data.activeFindingId || null,
      hint: "Finish or defer the current finding, then activate exactly one finding.",
    });
  }
}

function findingStatusEntries(runContext) {
  return Object.entries(runContext.data.findingStates || {});
}

function completedFinding(runContext, findingId, outcome) {
  ensureActive(runContext, findingId);
  const state = runContext.data.findingStates[findingId];
  state.status = "completed";
  state.outcome = outcome;
  state.completedAt = new Date().toISOString();
  runContext.data.activeFindingId = null;
  runContext.data.phase = findingStatusEntries(runContext).every(([, value]) => value.status === "completed")
    ? "completed"
    : "idle";
  saveRun(runContext);
  return state;
}

function ensureConfirmed(options, action) {
  if (!flag(options, "confirm")) {
    die(`${action} requires explicit --confirm`);
  }
}

function workspaceWorkDir(repo, workspace) {
  return workspace.mode === "worktree" ? workspace.path : repo.root;
}

function ensureWorkspaceCheckedOut(repo, workspace) {
  const workDir = workspaceWorkDir(repo, workspace);
  const actualBranch = runGit(workDir, ["branch", "--show-current"]).stdout;
  if (actualBranch !== workspace.branch) {
    die("Expected workspace branch is not checked out", {
      expected: workspace.branch,
      actual: actualBranch || null,
      workDir,
    });
  }
  return workDir;
}

function repositoryFile(workDir, input) {
  const file = relative(workDir, resolve(workDir, input));
  const insideRepo = file !== "" && !file.startsWith("..") && !isAbsolute(file);
  if (!insideRepo) die(`Commit file must be inside the workspace: ${input}`);
  return file.replaceAll("\\", "/");
}

function uniqueSorted(items) {
  return [...new Set(items)].sort();
}

function stagedFiles(workDir) {
  return uniqueSorted(
    runGit(workDir, ["diff", "--cached", "--name-only", "-z"]).stdout
      .split("\0")
      .filter(Boolean),
  );
}

function fileSetDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function ensureCommittedHead(workDir, workspace) {
  const currentHead = runGit(workDir, ["rev-parse", "HEAD"]).stdout;
  if (!workspace.commit || currentHead !== workspace.commit) {
    die("Workspace HEAD changed after the reviewed commit", {
      reviewedCommit: workspace.commit || null,
      currentHead,
      hint: "Repeat self-review and commit approval before pushing the updated branch.",
    });
  }
}

function listText(items, fallback = "- None specified") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function numberedText(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function render(template, replacements) {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function asset(name) {
  return readFileSync(join(SKILL_DIR, "assets", name), "utf8");
}

function repositoryTemplates(repo) {
  const templates = [];
  const candidates = [
    join(repo.root, ".github", "pull_request_template.md"),
    join(repo.root, ".gitlab", "merge_request_templates"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) templates.push(candidate);
  }

  const githubDirectory = join(repo.root, ".github", "PULL_REQUEST_TEMPLATE");
  if (existsSync(githubDirectory)) templates.push(githubDirectory);
  return templates;
}

function validateFindings(findings) {
  if (!Array.isArray(findings)) die("Findings file must contain a JSON array");
  if (findings.length > 5) die("Findings file must contain at most five entries");
  const ids = new Set();

  for (const finding of findings) {
    if (!finding || typeof finding !== "object") die("Each finding must be an object");
    if (!finding.id || ids.has(finding.id)) die("Each finding must have a unique id");
    ids.add(finding.id);
    if (!finding.title) die(`Finding ${finding.id} is missing title`);
    if (!SEVERITIES.has(finding.severity)) die(`Finding ${finding.id} has invalid severity`);
    if (!Number.isFinite(finding.confidence) || finding.confidence < 80 || finding.confidence > 100) {
      die(`Finding ${finding.id} confidence must be between 80 and 100`);
    }
    if (!Number.isFinite(finding.valueScore) || finding.valueScore < 0 || finding.valueScore > 100) {
      die(`Finding ${finding.id} valueScore must be between 0 and 100`);
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      die(`Finding ${finding.id} must include evidence`);
    }
    for (const evidence of finding.evidence) {
      if (!evidence.path || !evidence.detail) {
        die(`Finding ${finding.id} evidence requires path and detail`);
      }
    }
    for (const field of ["trigger", "impact", "recommendedFix"]) {
      if (!finding[field]) die(`Finding ${finding.id} is missing ${field}`);
    }
    if (!finding.example || typeof finding.example !== "object") {
      die(`Finding ${finding.id} is missing example`);
    }
    for (const field of ["scenario", "observed", "expected"]) {
      if (!finding.example[field]) die(`Finding ${finding.id} example is missing ${field}`);
    }
    if (!Array.isArray(finding.validation) || finding.validation.length === 0) {
      die(`Finding ${finding.id} must include validation steps`);
    }
  }
}

function handlePreflight(options) {
  const repo = repositoryInfo(required(options, "repo"));
  printJson({
    repository: repo,
    templates: repositoryTemplates(repo),
    adapters: {
      github: { command: "gh", available: commandExists("gh") },
      gitlab: { command: "glab", available: commandExists("glab") },
    },
    efficiency: efficiencyTools(repo),
  });
}

function handleToolsStatus(options) {
  const repo = repositoryInfo(required(options, "repo"));
  printJson(efficiencyTools(repo));
}

function providerConfig(provider, repo) {
  const origin = normalizeOrigin(repo.origin);
  if (provider === "github") {
    return {
      provider,
      command: "gh",
      host: origin?.host === "github.com" ? origin.host : "github.com",
      authArgs: ["auth", "status", "--hostname", origin?.host === "github.com" ? origin.host : "github.com"],
    };
  }
  if (provider === "gitlab") {
    return {
      provider,
      command: "glab",
      host: origin?.host?.includes("gitlab") ? origin.host : "gitlab.com",
      authArgs: ["auth", "status", "--hostname", origin?.host?.includes("gitlab") ? origin.host : "gitlab.com"],
    };
  }
  die(`Unsupported provider: ${provider}`);
}

function providerDoctor(provider, repo) {
  const config = providerConfig(provider, repo);
  const executable = findCommand(config.command);
  if (!executable) return { ...config, available: false, authenticated: false, hint: `Install and authenticate ${config.command} only if remote ${provider} access is needed.` };
  const auth = run(executable, config.authArgs, { allowFailure: true });
  return {
    ...config,
    available: true,
    version: commandVersion(config.command),
    authenticated: auth.ok,
    authStatus: sanitizeOutput(auth.ok ? auth.stdout : auth.stderr || auth.stdout),
    hint: auth.ok ? null : `Authenticate ${config.command} for ${config.host}, then rerun tools doctor.`,
  };
}

function handleToolsDoctor(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const requested = optional(options, "provider", "all");
  if (!["github", "gitlab", "all"].includes(requested)) die("--provider must be github, gitlab, or all");
  const providers = requested === "all" ? ["github", "gitlab"] : [requested];
  const originAccess = repo.origin
    ? runGit(repo.root, ["ls-remote", "--heads", "origin"], { allowFailure: true })
    : null;
  printJson({
    platform: { os: process.platform, arch: process.arch, node: process.version },
    git: { available: commandExists("git"), version: commandVersion("git") },
    origin: {
      configured: Boolean(repo.origin),
      value: sanitizeOutput(repo.origin),
      accessible: originAccess?.ok ?? null,
      error: originAccess?.ok === false ? sanitizeOutput(originAccess.stderr || originAccess.stdout) : null,
    },
    providers: Object.fromEntries(providers.map((provider) => [provider, providerDoctor(provider, repo)])),
    efficiency: efficiencyTools(repo),
  });
}

function remoteFetchCommands(scope) {
  if (scope.provider === "github") {
    return {
      command: "gh",
      metadataArgs: ["pr", "view", scope.url, "--json", "number,title,baseRefName,headRefName,files,url"],
      patchArgs: ["pr", "diff", scope.url],
    };
  }
  return {
    command: "glab",
    metadataArgs: ["mr", "view", scope.url, "--output", "json"],
    patchArgs: ["mr", "diff", scope.url],
  };
}

function jsonOrText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function handleRemoteFetch(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const scopes = runContext.data.scopes.filter((scope) => scope.type === "remote-review");
  if (scopes.length === 0) die("Run has no remote review scopes");
  const remoteReviews = scopes.map((scope) => {
    const commands = remoteFetchCommands(scope);
    const executable = findCommand(commands.command);
    if (!executable) {
      return { scope, status: "unavailable", hint: `Install and authenticate ${commands.command} only if remote ${scope.provider} analysis is needed.` };
    }
    const metadata = run(executable, commands.metadataArgs, { allowFailure: true });
    const patch = run(executable, commands.patchArgs, { allowFailure: true });
    if (!metadata.ok || !patch.ok) {
      return {
        scope,
        status: "unavailable",
        error: sanitizeOutput(metadata.stderr || patch.stderr || metadata.stdout || patch.stdout),
        hint: `Authenticate ${commands.command} and verify access to ${scope.url}, then rerun remote fetch.`,
      };
    }
    const stem = `${scope.provider}-${scope.number}`;
    const metadataFile = join(runContext.dir, "remote", `${stem}.json`);
    const patchFile = join(runContext.dir, "remote", `${stem}.patch`);
    const cached = { fetchedAt: new Date().toISOString(), scope, metadata: jsonOrText(metadata.stdout) };
    writeJson(metadataFile, cached);
    writeText(patchFile, patch.stdout);
    if (runContext.data.artifacts?.initialized) {
      writeArtifactJson(runContext, join("remote", `${stem}.json`), cached);
      writeArtifactText(runContext, join("remote", `${stem}.patch`), patch.stdout);
    }
    return { scope, status: "cached", metadataFile, patchFile };
  });
  printJson({ runId: runContext.data.id, localAnalysisAvailable: true, remoteReviews });
}

function handleArtifactsInitPreview(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const spec = artifactInitSpec(repo, runContext, options);
  const previewToken = recordPreview(runContext, "run", "artifacts init", spec);
  printJson({ action: "artifacts init", previewToken, ...spec });
}

function handleArtifactsInitRun(options) {
  ensureConfirmed(options, "artifacts init run");
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const spec = artifactInitSpec(repo, runContext, options);
  const previewContext = verifyPreview(runContext, "run", "artifacts init", spec, options);
  const ignoreUpdated = ensureIgnoreRule(spec.ignoreFile, spec.ignoreRule);
  mkdirSync(spec.artifactRoot, { recursive: true });
  runContext.data.artifacts = {
    initialized: true,
    sourceRoot: spec.artifactRoot,
    ignoreFile: spec.ignoreFile,
    ignoreRule: spec.ignoreRule,
    trackIgnore: spec.trackIgnore,
    workspaceRoots: runContext.data.artifacts?.workspaceRoots || {},
  };
  saveRun(runContext);
  consumePreview(previewContext);
  printJson({ action: "artifacts init", phase: "initialized", ignoreUpdated, artifacts: runContext.data.artifacts });
}

function handleArtifactsList(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runId = optional(options, "run-id") || latestRunId(repo, options);
  const runContext = loadRun(repo, options, runId);
  const roots = artifactRoots(runContext).map((root) => ({ root, files: artifactFiles(root) }));
  printJson({ runId, roots });
}

function handleArtifactsShow(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runId = optional(options, "run-id") || latestRunId(repo, options);
  const runContext = loadRun(repo, options, runId);
  const findingId = optional(options, "finding-id");
  const kind = optional(options, "kind", findingId ? "finding" : "summary");
  const provider = optional(options, "provider", "github");
  const relativePath = {
    summary: "findings.md",
    snapshot: "findings.json",
    finding: findingId ? join("findings", `${findingId}.md`) : null,
    plan: findingId ? join("workspaces", findingId, "plan.md") : null,
    "self-review": findingId ? join("workspaces", findingId, "self-review.md") : null,
    draft: findingId ? join("workspaces", findingId, `change-request-${provider}.md`) : null,
  }[kind];
  if (!relativePath) die(`Unsupported artifact kind or missing --finding-id: ${kind}`);
  const roots = artifactRoots(runContext);
  const file = roots.map((root) => join(root, relativePath)).find((candidate) => existsSync(candidate));
  if (!file) die(`Artifact not found: ${relativePath}`);
  printJson({ runId, findingId: findingId || null, kind, file, content: readFileSync(file, "utf8") });
}

function handleScopeNormalize(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const requestedScopes = values(options, "scope").map(String);
  const base = optional(options, "base");
  const head = optional(options, "head");
  if ((base && !head) || (!base && head)) die("--base and --head must be used together");
  if (base && head) requestedScopes.push(`${base}...${head}`);
  if (requestedScopes.length === 0) die("Provide at least one --scope or a --base/--head pair");

  const scopes = uniqueScopes(requestedScopes.map((scope) => normalizeScope(repo, scope)));
  const runId = optional(options, "run-id", nextRunId());
  const file = runFile(repo, options, runId);
  if (existsSync(file)) die(`Run already exists: ${runId}`);

  const now = new Date().toISOString();
  const runContext = {
    file,
    dir: dirname(file),
    data: {
      schemaVersion: SCHEMA_VERSION,
      helperVersion: HELPER_VERSION,
      id: runId,
      repository: repo,
      phase: "scoped",
      scopes,
      efficiency: efficiencyTools(repo),
      createdAt: now,
      updatedAt: now,
    },
  };
  saveRun(runContext);
  writeJson(join(runContext.dir, "scopes.json"), scopes);
  printJson({ runId, phase: "scoped", repository: repo.root, scopes });
}

function handleStateStatus(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runId = optional(options, "run-id") || latestRunId(repo, options);
  const runContext = loadRun(repo, options, runId);
  const workspaceDirectory = join(runContext.dir, "workspaces");
  const workspaces = [];

  if (existsSync(workspaceDirectory)) {
    for (const findingId of runContext.data.workspaceFindingIds || []) {
      const file = workspaceFile(runContext, findingId);
      if (existsSync(file)) {
        const workspace = readJson(file);
        requireSchema(workspace, `Workspace ${findingId}`);
        workspaces.push(workspace);
      }
    }
  }

  const states = findingStatusEntries(runContext);
  printJson({
    stateDirectory: runContext.dir,
    artifactRoots: runContext.data.artifacts?.initialized ? artifactRoots(runContext) : [],
    activeFindingId: runContext.data.activeFindingId || null,
    availableFindingIds: states.filter(([, state]) => state.status === "available").map(([id]) => id),
    completedFindingIds: states.filter(([, state]) => state.status === "completed").map(([id]) => id),
    deferredFindingIds: states.filter(([, state]) => state.status === "deferred").map(([id]) => id),
    nextAction: runContext.data.artifacts?.initialized
      ? (runContext.data.activeFindingId ? `Continue ${runContext.data.activeFindingId}` : "Activate one available or deferred finding")
      : "Initialize repository-local artifacts",
    run: runContext.data,
    workspaces,
  });
}

function handleRecordFindings(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  requireRunPhase(runContext, "scoped");
  const source = resolve(required(options, "file"));
  const findings = readJson(source);
  validateFindings(findings);
  ensureArtifactsInitialized(runContext);
  writeJson(join(runContext.dir, "findings.json"), findings);
  runContext.data.phase = "findings_ready";
  runContext.data.findingCount = findings.length;
  runContext.data.findingStates = Object.fromEntries(findings.map((finding) => [finding.id, { status: "available" }]));
  runContext.data.workspaceFindingIds = [];
  saveRun(runContext);
  writeFindingsArtifacts(runContext, findings);
  printJson({ runId: runContext.data.id, phase: runContext.data.phase, findingCount: findings.length });
}

function activateFinding(runContext, findingId) {
  if (runContext.data.activeFindingId) die(`Finding is already active: ${runContext.data.activeFindingId}`);
  requireRunPhase(runContext, ["findings_ready", "idle"]);
  findingById(runContext, findingId);
  const state = runContext.data.findingStates?.[findingId];
  if (!state || !["available", "deferred"].includes(state.status)) {
    die(`Finding cannot be activated: ${findingId}`, { status: state?.status || null });
  }
  state.status = "active";
  state.activatedAt = new Date().toISOString();
  runContext.data.activeFindingId = findingId;
  runContext.data.phase = "active";
  writeJson(join(runContext.dir, "selection.json"), { activeFindingId: findingId });
  saveRun(runContext);
}

function handleActivate(options, { deprecated = false } = {}) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const ids = [...new Set(values(options, "id").map(String))];
  if (ids.length !== 1) die("Activate exactly one --id");
  activateFinding(runContext, ids[0]);
  printJson({ runId: runContext.data.id, phase: runContext.data.phase, activeFindingId: ids[0], deprecated });
}

function handleStateFinish(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  const outcome = required(options, "outcome");
  if (!["committed", "pushed", "submitted"].includes(outcome)) die("--outcome must be committed, pushed, or submitted");
  const workspaceContext = loadWorkspace(runContext, findingId);
  if (!phaseAtLeast(workspaceContext.data.phase, outcome)) {
    die(`Workspace has not reached ${outcome}`, { actual: workspaceContext.data.phase });
  }
  const state = completedFinding(runContext, findingId, outcome);
  printJson({ findingId, phase: runContext.data.phase, findingStatus: state.status, outcome });
}

function handleStateDefer(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const state = runContext.data.findingStates[findingId];
  state.status = "deferred";
  state.reason = required(options, "reason");
  state.deferredAt = new Date().toISOString();
  runContext.data.activeFindingId = null;
  runContext.data.phase = "idle";
  saveRun(runContext);
  printJson({ findingId, phase: runContext.data.phase, findingStatus: state.status });
}

function handleStateMark(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  const target = required(options, "to");
  const currentIndex = WORKSPACE_PHASES.indexOf(workspaceContext.data.phase);
  const targetIndex = WORKSPACE_PHASES.indexOf(target);
  if (targetIndex < 0) die(`Unsupported workspace phase: ${target}`);
  if (targetIndex !== currentIndex + 1) {
    die("Workspace transitions must advance exactly one phase", {
      current: workspaceContext.data.phase,
      requested: target,
    });
  }

  if (target === "plan_approved") {
    const planFile = join(runContext.dir, "plans", `${findingId}.md`);
    if (!existsSync(planFile)) die("Render the action plan before approving it");
  }

  if (target === "self_reviewed") {
    const selfReviewSource = resolve(required(options, "self-review-file"));
    if (!existsSync(selfReviewSource)) die(`Self-review file not found: ${selfReviewSource}`);
    const selfReviewTarget = join(runContext.dir, "self-reviews", `${findingId}.md`);
    mkdirSync(dirname(selfReviewTarget), { recursive: true });
    copyFileSync(selfReviewSource, selfReviewTarget);
    writeArtifactText(runContext, join("workspaces", findingId, "self-review.md"), readFileSync(selfReviewSource, "utf8"));
  }

  workspaceContext.data.phase = target;
  saveWorkspace(workspaceContext);
  printJson({ findingId, phase: target });
}

function workspaceRefs(repo, runContext, options) {
  const explicitStartRef = optional(options, "start-ref");
  const explicitTargetBranch = optional(options, "target-branch");
  if ((explicitStartRef && !explicitTargetBranch) || (!explicitStartRef && explicitTargetBranch)) {
    die("--start-ref and --target-branch must be used together");
  }
  if (explicitStartRef && explicitTargetBranch) {
    if (!commitishExists(repo.root, explicitStartRef)) die(`Invalid workspace start ref: ${explicitStartRef}`);
    return { startRef: explicitStartRef, targetBranch: explicitTargetBranch };
  }

  const diffScopes = runContext.data.scopes.filter((scope) => !["directory", "file"].includes(scope.type));
  if (diffScopes.length === 0) {
    if (!repo.branch) die("Cannot derive workspace refs from a detached HEAD; provide --start-ref and --target-branch");
    return { startRef: repo.branch, targetBranch: repo.branch };
  }
  if (diffScopes.length > 1) {
    die("Cannot derive workspace refs from multiple diff scopes; provide --start-ref and --target-branch");
  }

  const [scope] = diffScopes;
  if (scope.type === "comparison") return { startRef: scope.head, targetBranch: scope.base };
  if (scope.type === "revision") {
    if (!repo.branch) die("Cannot derive target branch from a detached HEAD; provide --start-ref and --target-branch");
    return { startRef: scope.ref, targetBranch: repo.branch };
  }
  die("Cannot derive workspace refs from a remote review scope; provide --start-ref and --target-branch");
}

function workspaceSpec(repo, runContext, options) {
  requireRunPhase(runContext, "active");
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const finding = findingById(runContext, findingId);
  const mode = required(options, "mode");
  if (!["branch", "worktree"].includes(mode)) die("--mode must be branch or worktree");
  const slug = slugify(optional(options, "slug", finding.title));
  const branch = `review/${runContext.data.id}/${findingId.toLowerCase()}-${slug}`;
  const { startRef, targetBranch } = workspaceRefs(repo, runContext, options);
  const worktreePath = resolve(
    optional(options, "path", join(dirname(repo.root), `${basename(repo.root)}-${findingId.toLowerCase()}`)),
  );
  const args = mode === "worktree"
    ? ["worktree", "add", "-b", branch, worktreePath, startRef]
    : ["branch", branch, startRef];

  return { findingId, finding, mode, branch, startRef, targetBranch, path: mode === "worktree" ? worktreePath : repo.root, args };
}

function handleWorkspacePreview(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const spec = workspaceSpec(repo, runContext, options);
  const previewToken = recordPreview(runContext, spec.findingId, "workspace create", spec);
  printJson({
    action: "workspace create",
    previewToken,
    repositoryDirty: repo.dirty,
    dirtyFiles: repo.dirtyFiles,
    command: formatCommand("git", ["-C", repo.root, ...spec.args]),
    workspace: spec,
  });
}

function handleWorkspaceCreate(options) {
  ensureConfirmed(options, "workspace create");
  const repo = repositoryInfo(required(options, "repo"));
  if (repo.dirty && !flag(options, "allow-dirty")) {
    die("Repository has uncommitted changes; inspect them before workspace creation", {
      dirtyFiles: repo.dirtyFiles,
      hint: "Re-run with --allow-dirty only after the user explicitly approves preserving the existing changes.",
    });
  }
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const spec = workspaceSpec(repo, runContext, options);
  const previewContext = verifyPreview(runContext, spec.findingId, "workspace create", spec, options);
  if (existsSync(workspaceFile(runContext, spec.findingId))) {
    die(`Workspace already recorded for finding: ${spec.findingId}`);
  }
  if (runGit(repo.root, ["show-ref", "--verify", "--quiet", `refs/heads/${spec.branch}`], {
    allowFailure: true,
  }).ok) {
    die(`Branch already exists: ${spec.branch}`);
  }
  if (spec.mode === "worktree" && existsSync(spec.path)) {
    die(`Worktree path already exists: ${spec.path}`);
  }

  runGit(repo.root, spec.args);
  const now = new Date().toISOString();
  const workspaceContext = {
    file: workspaceFile(runContext, spec.findingId),
    data: {
      schemaVersion: SCHEMA_VERSION,
      findingId: spec.findingId,
      mode: spec.mode,
      branch: spec.branch,
      startRef: spec.startRef,
      targetBranch: spec.targetBranch,
      path: spec.path,
      phase: "workspace_ready",
      createdAt: now,
      updatedAt: now,
    },
  };
  saveWorkspace(workspaceContext);
  if (!runContext.data.workspaceFindingIds.includes(spec.findingId)) runContext.data.workspaceFindingIds.push(spec.findingId);
  const artifactRoot = mirrorArtifactsToWorkspace(runContext, spec.findingId, spec.path);
  workspaceContext.data.artifactRoot = artifactRoot;
  saveWorkspace(workspaceContext);
  consumePreview(previewContext);
  printJson({ findingId: spec.findingId, phase: "workspace_ready", workspace: workspaceContext.data });
}

function handlePlanRender(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  const finding = findingById(runContext, findingId);
  requireWorkspacePhase(workspaceContext, ["workspace_ready", "plan_ready"]);
  const steps = values(options, "step").map(String);
  const tests = values(options, "test").map(String);
  if (steps.length === 0) die("Provide at least one --step");
  if (tests.length === 0) die("Provide at least one --test");
  const content = render(asset("action-plan.md"), {
    title: required(options, "title"),
    finding: required(options, "finding"),
    exampleScenario: finding.example.scenario,
    exampleObserved: finding.example.observed,
    exampleExpected: finding.example.expected,
    findingId,
    branch: workspaceContext.data.branch,
    workspace: workspaceContext.data.path,
    steps: numberedText(steps),
    files: listText(values(options, "file").map(String)),
    tests: listText(tests),
    criteria: listText(values(options, "criterion").map(String)),
  });
  const planFile = join(runContext.dir, "plans", `${findingId}.md`);
  writeText(planFile, content);
  writeArtifactText(runContext, join("workspaces", findingId, "plan.md"), content);
  workspaceContext.data.phase = "plan_ready";
  workspaceContext.data.planFile = planFile;
  saveWorkspace(workspaceContext);
  printJson({ findingId, phase: "plan_ready", planFile });
}

function handleDraftRender(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  if (!phaseAtLeast(workspaceContext.data.phase, "self_reviewed")) {
    die("Complete self-review before rendering a change request draft");
  }
  const provider = required(options, "provider");
  if (!["github", "gitlab"].includes(provider)) die("--provider must be github or gitlab");
  const templateFile = optional(options, "template-file");
  const template = templateFile ? readFileSync(resolve(templateFile), "utf8") : asset(`${provider === "github" ? "github-pr" : "gitlab-mr"}.md`);
  const risk = optional(options, "risk");
  const content = render(template, {
    summary: required(options, "summary"),
    changes: listText(values(options, "change").map(String)),
    testing: listText(values(options, "testing").map(String)),
    risk: risk ? `\n## Risk\n${risk}\n` : "",
  });
  const output = join(runContext.dir, "change-requests", `${findingId}-${provider}.md`);
  writeText(output, content);
  writeArtifactText(runContext, join("workspaces", findingId, `change-request-${provider}.md`), content);
  const title = required(options, "title");
  writeJson(join(runContext.dir, "change-requests", `${findingId}-${provider}.json`), {
    provider,
    title,
    bodyFile: output,
  });
  printJson({ findingId, provider, title, bodyFile: output });
}

function handleCommitPreview(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  requireWorkspacePhase(workspaceContext, ["self_reviewed", "commit_pending"]);
  const workDir = ensureWorkspaceCheckedOut(repo, workspaceContext.data);
  const message = required(options, "message");
  const approvedFiles = uniqueSorted(values(options, "file").map((file) => repositoryFile(workDir, String(file))));
  if (approvedFiles.length === 0) die("Provide at least one --file for the intended commit");
  const previewToken = recordPreview(runContext, findingId, "commit run", { message, approvedFiles });
  printJson({
    action: "commit",
    findingId,
    previewToken,
    command: formatCommand("git", ["-C", workDir, "commit", "-m", message]),
    changes: runGit(workDir, ["status", "--porcelain"]).stdout.split(/\r?\n/).filter(Boolean),
    approvedFiles,
    stagedFiles: stagedFiles(workDir),
  });
}

function handleCommitRun(options) {
  ensureConfirmed(options, "commit run");
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  requireWorkspacePhase(workspaceContext, "commit_pending");
  const workDir = ensureWorkspaceCheckedOut(repo, workspaceContext.data);
  const message = required(options, "message");
  const approvedFiles = uniqueSorted(values(options, "file").map((file) => repositoryFile(workDir, String(file))));
  if (approvedFiles.length === 0) die("Provide at least one --file matching the approved commit preview");
  const previewContext = verifyPreview(runContext, findingId, "commit run", { message, approvedFiles }, options);
  const changes = runGit(workDir, ["status", "--porcelain"]).stdout;
  if (!changes) die("No changes to commit");
  const actualStagedFiles = stagedFiles(workDir);
  if (actualStagedFiles.length === 0) die("No staged changes to commit; stage the intended files explicitly before committing");
  const missingFiles = fileSetDifference(approvedFiles, actualStagedFiles);
  const unexpectedFiles = fileSetDifference(actualStagedFiles, approvedFiles);
  if (missingFiles.length || unexpectedFiles.length) {
    die("Staged files do not match the approved commit files", {
      approvedFiles,
      stagedFiles: actualStagedFiles,
      missingFiles,
      unexpectedFiles,
    });
  }
  runGit(workDir, ["commit", "-m", message]);
  workspaceContext.data.phase = "committed";
  workspaceContext.data.commit = runGit(workDir, ["rev-parse", "HEAD"]).stdout;
  saveWorkspace(workspaceContext);
  consumePreview(previewContext);
  printJson({ findingId, phase: "committed", commit: workspaceContext.data.commit });
}

function handlePushPreview(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  requireWorkspacePhase(workspaceContext, ["committed", "push_pending"]);
  const workDir = ensureWorkspaceCheckedOut(repo, workspaceContext.data);
  ensureCommittedHead(workDir, workspaceContext.data);
  const remote = optional(options, "remote", "origin");
  const previewToken = recordPreview(runContext, findingId, "push run", {
    branch: workspaceContext.data.branch,
    remote,
    reviewedCommit: workspaceContext.data.commit,
  });
  printJson({
    action: "push",
    findingId,
    previewToken,
    command: formatCommand("git", ["-C", workDir, "push", "-u", remote, workspaceContext.data.branch]),
  });
}

function handlePushRun(options) {
  ensureConfirmed(options, "push run");
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  requireWorkspacePhase(workspaceContext, "push_pending");
  const workDir = ensureWorkspaceCheckedOut(repo, workspaceContext.data);
  ensureCommittedHead(workDir, workspaceContext.data);
  const remote = optional(options, "remote", "origin");
  const previewContext = verifyPreview(runContext, findingId, "push run", {
    branch: workspaceContext.data.branch,
    remote,
    reviewedCommit: workspaceContext.data.commit,
  }, options);
  runGit(workDir, ["push", "-u", remote, workspaceContext.data.branch]);
  workspaceContext.data.phase = "pushed";
  workspaceContext.data.remote = remote;
  saveWorkspace(workspaceContext);
  consumePreview(previewContext);
  printJson({ findingId, phase: "pushed", remote });
}

function submitSpec(repo, workspace, options) {
  const provider = required(options, "provider");
  if (!["github", "gitlab"].includes(provider)) die("--provider must be github or gitlab");
  const title = required(options, "title");
  const bodyFile = resolve(required(options, "body-file"));
  if (!existsSync(bodyFile)) die(`Body file not found: ${bodyFile}`);
  const base = optional(options, "base", workspace.targetBranch || workspace.base);
  if (!base) die("Missing target branch; provide --base");
  const isDraft = flag(options, "draft");

  if (provider === "github") {
    const args = ["pr", "create", "--title", title, "--body-file", bodyFile, "--base", base];
    if (isDraft) args.push("--draft");
    return { provider, command: "gh", args, bodyFile, bodyHash: shortHash(readFileSync(bodyFile, "utf8")), base };
  }

  const body = readFileSync(bodyFile, "utf8");
  const args = [
    "mr", "create",
    "--title", title,
    "--description", body,
    "--target-branch", base,
    "--source-branch", workspace.branch,
  ];
  if (isDraft) args.push("--draft");
  return { provider, command: "glab", args, bodyFile, bodyHash: shortHash(body), base };
}

function handleSubmitPreview(options) {
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  requireWorkspacePhase(workspaceContext, ["pushed", "submit_pending"]);
  const spec = submitSpec(repo, workspaceContext.data, options);
  const previewToken = recordPreview(runContext, findingId, "submit run", spec);
  printJson({
    action: "submit",
    findingId,
    previewToken,
    provider: spec.provider,
    adapterAvailable: commandExists(spec.command),
    command: formatCommand(spec.command, spec.args),
  });
}

function handleSubmitRun(options) {
  ensureConfirmed(options, "submit run");
  const repo = repositoryInfo(required(options, "repo"));
  const runContext = loadRun(repo, options, required(options, "run-id"));
  const findingId = required(options, "finding-id");
  ensureActive(runContext, findingId);
  const workspaceContext = loadWorkspace(runContext, findingId);
  requireWorkspacePhase(workspaceContext, "submit_pending");
  const spec = submitSpec(repo, workspaceContext.data, options);
  const previewContext = verifyPreview(runContext, findingId, "submit run", spec, options);
  const executable = findCommand(spec.command);
  if (!executable) {
    die(`Missing provider CLI: ${spec.command}`, {
      hint: `Install and authenticate ${spec.command}, then re-run submit preview and submit run.`,
    });
  }
  const workDir = ensureWorkspaceCheckedOut(repo, workspaceContext.data);
  const result = run(executable, spec.args, { cwd: workDir });
  workspaceContext.data.phase = "submitted";
  workspaceContext.data.submission = result.stdout;
  saveWorkspace(workspaceContext);
  consumePreview(previewContext);
  completedFinding(runContext, findingId, "submitted");
  printJson({ findingId, phase: "submitted", findingStatus: "completed", provider: spec.provider, output: result.stdout });
}

function printHelp() {
  process.stdout.write(`reviewctl.mjs

Commands:
  preflight --repo <path>
  version
  tools status --repo <path>
  tools doctor --repo <path> [--provider <github|gitlab|all>]
  scope normalize --repo <path> --scope <value> [--scope <value> ...]
  remote fetch --repo <path> --run-id <id>
  artifacts init preview|run --repo <path> --run-id <id> [--track-ignore] [--preview-token <token>]
  artifacts list --repo <path> [--run-id <id>]
  artifacts show --repo <path> [--run-id <id>] [--finding-id <id>] [--kind <kind>]
  state status --repo <path> [--run-id <id>]
  state record-findings --repo <path> --run-id <id> --file <findings.json>
  state activate --repo <path> --run-id <id> --id <finding-id>
  state select --repo <path> --run-id <id> --id <finding-id>
  state finish --repo <path> --run-id <id> --finding-id <id> --outcome <committed|pushed|submitted>
  state defer --repo <path> --run-id <id> --finding-id <id> --reason <text>
  state mark --repo <path> --run-id <id> --finding-id <id> --to <phase>
  workspace preview|create --repo <path> --run-id <id> --finding-id <id> --mode <branch|worktree> [--preview-token <token>]
  plan render --repo <path> --run-id <id> --finding-id <id> --title <text> --finding <text> --step <text> --test <text>
  draft render --repo <path> --run-id <id> --finding-id <id> --provider <github|gitlab> --title <text> --summary <text> --change <text> --testing <text>
  commit preview|run --repo <path> --run-id <id> --finding-id <id> --message <text> --file <path> [--file <path> ...] [--preview-token <token>]
  push preview|run --repo <path> --run-id <id> --finding-id <id> [--preview-token <token>]
  submit preview|run --repo <path> --run-id <id> --finding-id <id> --provider <github|gitlab> --title <text> --body-file <file> [--preview-token <token>]

Mutating create/run commands require --confirm.
Mutating create/run commands also require the one-time --preview-token returned by the matching preview.
Use --state-home <path> to override external state storage.
`);
}

function main(argv) {
  const [group = "help", action, ...rest] = argv;
  const { options } = parseArgs(rest);

  if (group === "help" || group === "--help" || group === "-h") return printHelp();
  if (group === "version") return printJson({ version: HELPER_VERSION, schemaVersion: SCHEMA_VERSION });
  if (group === "preflight") return handlePreflight(parseArgs([action, ...rest].filter(Boolean)).options);
  if (group === "tools" && action === "status") return handleToolsStatus(options);
  if (group === "tools" && action === "doctor") return handleToolsDoctor(options);
  if (group === "scope" && action === "normalize") return handleScopeNormalize(options);
  if (group === "remote" && action === "fetch") return handleRemoteFetch(options);
  if (group === "artifacts" && action === "init" && rest[0] === "preview") return handleArtifactsInitPreview(parseArgs(rest.slice(1)).options);
  if (group === "artifacts" && action === "init" && rest[0] === "run") return handleArtifactsInitRun(parseArgs(rest.slice(1)).options);
  if (group === "artifacts" && action === "list") return handleArtifactsList(options);
  if (group === "artifacts" && action === "show") return handleArtifactsShow(options);
  if (group === "state" && action === "status") return handleStateStatus(options);
  if (group === "state" && action === "record-findings") return handleRecordFindings(options);
  if (group === "state" && action === "activate") return handleActivate(options);
  if (group === "state" && action === "select") return handleActivate(options, { deprecated: true });
  if (group === "state" && action === "finish") return handleStateFinish(options);
  if (group === "state" && action === "defer") return handleStateDefer(options);
  if (group === "state" && action === "mark") return handleStateMark(options);
  if (group === "workspace" && action === "preview") return handleWorkspacePreview(options);
  if (group === "workspace" && action === "create") return handleWorkspaceCreate(options);
  if (group === "plan" && action === "render") return handlePlanRender(options);
  if (group === "draft" && action === "render") return handleDraftRender(options);
  if (group === "commit" && action === "preview") return handleCommitPreview(options);
  if (group === "commit" && action === "run") return handleCommitRun(options);
  if (group === "push" && action === "preview") return handlePushPreview(options);
  if (group === "push" && action === "run") return handlePushRun(options);
  if (group === "submit" && action === "preview") return handleSubmitPreview(options);
  if (group === "submit" && action === "run") return handleSubmitRun(options);
  die(`Unsupported command: ${[group, action].filter(Boolean).join(" ")}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const output = {
    error: error.message,
  };
  if (error.details !== undefined) output.details = error.details;
  process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = 1;
}
