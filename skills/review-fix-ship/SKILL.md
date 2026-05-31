---
name: review-fix-ship
description: Find up to five verified high-value code review findings across Git branches, comparisons, directories, files, GitHub PR URLs, or GitLab MR URLs; optionally use caveman, rtk, and CodeGraph to reduce token consumption; let the user select findings; create guarded branches or worktrees; write actionable fix plans; implement only after plan approval; self-review changes; and prepare concise English PR or MR drafts with explicit confirmation gates for commit, push, and remote creation. Use when Codex or GitHub Copilot needs a macOS, Linux, or Windows compatible end-to-end review, planning, repair, or PR/MR preparation workflow without modifying the target repository before the user approves each gated phase.
---

# Review Fix Ship

Use a review-first workflow with explicit approval gates. Keep repository mutations separate from analysis. Never invent findings to reach five items.

This Agent Skill supports Codex and GitHub Copilot. Read [hosts.md](references/hosts.md) when installing, publishing, or troubleshooting host discovery.

## Quick Start

1. Locate this skill directory and set the helper path. Commands below work on macOS, Linux, and Windows with Node.js `>= 18`.

   macOS or Linux:

   ```bash
   reviewctl="<skill-dir>/scripts/reviewctl.mjs"
   ```

   Windows PowerShell:

   ```powershell
   $reviewctl = "<skill-dir>\scripts\reviewctl.mjs"
   ```

2. Inspect the repository before analysis:

   ```powershell
   node "$reviewctl" preflight --repo <repo>
   node "$reviewctl" tools status --repo <repo>
   node "$reviewctl" scope normalize --repo <repo> --scope <scope> [--scope <scope> ...]
   ```

3. Apply the token-efficiency recommendations returned by `preflight`. Read [token-efficiency.md](references/token-efficiency.md) before exploring the codebase and [platforms.md](references/platforms.md) when shell or OS differences matter.

4. Use the returned `runId` for all later commands. Read [review-rubric.md](references/review-rubric.md) before producing findings and [output-contracts.md](references/output-contracts.md) before recording them.

5. Record verified findings and ask the user which IDs to handle:

   ```powershell
   node "$reviewctl" state record-findings --repo <repo> --run-id <run-id> --file <findings.json>
   node "$reviewctl" state select --repo <repo> --run-id <run-id> --id <finding-id> [--id <finding-id> ...]
   ```

6. For every selected finding, ask whether to create a branch or worktree. Always show `workspace preview` output before asking for approval and running `workspace create --confirm`.

## Review Workflow

### 1. Normalize Scope

Bind one run to one repository. Accept multiple scopes and merge them into one review surface:

- branch names or commit-ish values
- `base...head` comparisons
- repository-relative directories or files
- GitHub PR URLs
- GitLab MR URLs, including self-hosted GitLab

Use `scope normalize`; do not hand-edit run state. Reject remote URLs that conflict with the repository origin when an origin exists. Treat directory and file scopes as filters over each diff target.
When a repository path and revision have the same name, reject the ambiguous input and ask for `ref:<value>` or `path:<value>`. Keep unprefixed values for unambiguous scopes.

If a PR or MR URL requires a missing provider CLI, continue local analysis where possible and report the missing adapter. Read [providers.md](references/providers.md) only when remote input or submission is involved.

### 2. Use Token-Efficient Tools

Treat `caveman`, `rtk`, and CodeGraph as optional accelerators. Use them autonomously when detected, but preserve the no-dependency fallback.

- Activate installed `caveman` concise mode for progress and summaries. Keep findings, approval prompts, plans, and PR/MR drafts complete.
- Prefer explicit `rtk` wrappers for high-volume exploratory shell output such as Git status, diffs, searches, file reads, lint, builds, and tests. Keep `reviewctl` state operations raw.
- Prefer CodeGraph MCP tools for structural questions, call paths, and impact analysis when available. Use CodeGraph CLI as a fallback. Ask before running `codegraph init -i` because it creates `.codegraph/` in the target repository.
- Never install or globally configure an accelerator without user approval.

Read [token-efficiency.md](references/token-efficiency.md) for the decision table and fallbacks.

### 3. Find and Verify Issues

Review the normalized surface from five perspectives: correctness, security, reliability/performance, API/data-contract, and test gaps. Run independent passes in parallel when subagents are available. Otherwise perform focused sequential passes.

Run a verifier pass over every candidate. Keep only findings with concrete evidence, confidence `>= 80`, and a material impact. Return at most five findings globally across all requested scopes. Rank by severity, blast radius, reproducibility, and fix leverage. Do not include style-only comments or speculative concerns.

Present the findings in Chinese for user selection. Include the evidence location, trigger, impact, recommended fix, viable alternative, and validation approach.

### 4. Isolate Selected Work

Handle each selected finding independently unless the user explicitly requests a combined change. Ask the user to choose branch or worktree for each finding; do not apply a silent default.

Use:

```powershell
node "$reviewctl" workspace preview --repo <repo> --run-id <run-id> --finding-id <id> --mode <branch|worktree> [--path <path>]
node "$reviewctl" workspace create  --repo <repo> --run-id <run-id> --finding-id <id> --mode <branch|worktree> [--path <path>] --confirm
```

Never force branch creation, reset state, delete worktrees, or clean user changes.

### 5. Write and Approve the Plan

Write a detailed action plan using `plan render`; include the finding evidence, implementation steps, expected files, tests, and completion criteria. The plan is saved outside the repository.

```powershell
node "$reviewctl" plan render --repo <repo> --run-id <run-id> --finding-id <id> --title <title> --finding <text> --step <step> --test <test>
node "$reviewctl" state mark --repo <repo> --run-id <run-id> --finding-id <id> --to plan_approved
```

Show the rendered plan and wait for explicit user approval before marking `plan_approved`. Do not modify repository files before that mark succeeds.

### 6. Implement and Self-Review

Enter the selected workspace, mark `implementing`, implement the approved plan, and run repository-native lint, tests, and build checks. Then inspect the complete diff for correctness, maintainability, security, regressions, and missing tests. Fix any issues and repeat checks.

Record a concise self-review file under the run directory, then advance:

```powershell
node "$reviewctl" state mark --repo <repo> --run-id <run-id> --finding-id <id> --to implementing
node "$reviewctl" state mark --repo <repo> --run-id <run-id> --finding-id <id> --to self_reviewed --self-review-file <file>
```

Read [workflow-state.md](references/workflow-state.md) when recovering an interrupted run or troubleshooting a blocked transition.

### 7. Prepare and Submit the Change Request

Render an English draft after self-review. Follow repository templates and title conventions when present. Otherwise use `type(scope): concise summary` and the bundled provider template.

```powershell
node "$reviewctl" draft render --repo <repo> --run-id <run-id> --finding-id <id> --provider <github|gitlab> --title <title> --summary <summary> --change <change> --testing <test>
```

Require separate user approval before each mutation:

Stage only the intended files after implementation and self-review. Do not use an unscoped `git add .` when unrelated changes exist.

```powershell
node "$reviewctl" commit preview --repo <repo> --run-id <run-id> --finding-id <id> --message <message>
node "$reviewctl" commit run     --repo <repo> --run-id <run-id> --finding-id <id> --message <message> --confirm
node "$reviewctl" push preview   --repo <repo> --run-id <run-id> --finding-id <id>
node "$reviewctl" push run       --repo <repo> --run-id <run-id> --finding-id <id> --confirm
node "$reviewctl" submit preview --repo <repo> --run-id <run-id> --finding-id <id> --provider <github|gitlab> --title <title> --body-file <file>
node "$reviewctl" submit run     --repo <repo> --run-id <run-id> --finding-id <id> --provider <github|gitlab> --title <title> --body-file <file> --confirm
```

Never call `gh pr create --dry-run`; it may still push. Never pass `--fill`, `--push`, or `--yes` to `glab mr create`. If `gh` or `glab` is missing, return the generated draft and explain the installation or authentication requirement. Do not install CLIs automatically.

## Resources

- Read [review-rubric.md](references/review-rubric.md) for ranking and verification.
- Read [workflow-state.md](references/workflow-state.md) for states, guards, and recovery.
- Read [providers.md](references/providers.md) for GitHub and GitLab behavior.
- Read [platforms.md](references/platforms.md) for macOS, Linux, and Windows requirements.
- Read [hosts.md](references/hosts.md) for Codex and GitHub Copilot installation paths.
- Read [token-efficiency.md](references/token-efficiency.md) for optional `caveman`, `rtk`, and CodeGraph usage.
- Read [output-contracts.md](references/output-contracts.md) for persisted JSON and Markdown shapes.
- Run `node scripts/reviewctl.mjs help` for the deterministic helper interface.
