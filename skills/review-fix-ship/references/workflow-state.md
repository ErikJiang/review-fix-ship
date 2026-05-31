# Workflow State

## Storage

Store authoritative machine state outside the target repository:

```text
${REVIEW_FIX_SHIP_HOME:-${CODEX_HOME:-~/.codex}/review-fix-ship}/
  repos/<fingerprint>/runs/<run-id>/
```

The fingerprint derives from the Git common directory so linked worktrees share a run.
New runs use schema v2. Pre-release schema versions are rejected with a prompt to create a new run; no migration is attempted before real-user compatibility requirements exist.

After an explicit `artifacts init preview` and `artifacts init run --confirm`, mirror readable reports and plans under:

```text
<repo-or-worktree>/.review-fix-ship/runs/<run-id>/
```

Default initialization adds `.review-fix-ship/` to the Git common directory's `info/exclude`. Use `--track-ignore` only when the user explicitly wants to append the rule to the repository `.gitignore`.

## Run State

The run-level sequence is:

```text
scoped -> findings_ready -> active -> idle -> active
                                      \-> completed
```

Keep at most one active finding. Preserve available, deferred, and completed findings so the user can process the report serially.
Use one workspace record per activated finding.
Each workspace stores a repair `startRef` separately from the later PR or MR `targetBranch`. A single `base...head` comparison maps to `startRef=head` and `targetBranch=base`.

Use `state activate` to choose one finding, `state defer` to release unfinished work, and `state finish --outcome <committed|pushed|submitted>` to release locally completed work. Successful PR or MR submission completes the active finding automatically.

## Workspace State

The per-finding sequence is:

```text
workspace_ready -> plan_ready -> plan_approved -> implementing
-> self_reviewed -> commit_pending -> committed -> push_pending
-> pushed -> submit_pending -> submitted
```

`reviewctl.mjs` rejects skipped or backward transitions. Use repeated `state status` calls to recover context after interruption.

## Mutation Guards

- `workspace create`, `commit run`, `push run`, and `submit run` require `--confirm`.
- `artifacts init run` requires `--confirm` before writing the ignored repository-local mirror.
- Each mutating create or run also requires the matching preview's one-time `--preview-token`; reject missing, changed, stale, or replayed approvals.
- `commit run` requires `commit_pending`.
- `commit preview` records an explicit repository-relative file allowlist; `commit run` rejects staged files unless the set matches exactly.
- `push run` requires `push_pending`.
- `push preview` and `push run` require `HEAD` to equal the commit recorded by `commit run`; repeat self-review and commit approval after any branch change.
- `submit run` requires `submit_pending`.
- Repository file edits are allowed only after `plan_approved`.
- A branch-only workspace must be checked out manually before implementation or Git mutations.
- Never use force operations, destructive cleanup, or implicit remote submission.

Use `state mark` for non-mutating workflow milestones. `state mark --to commit_pending`, `push_pending`, or `submit_pending` records that the user has reached the matching approval discussion; the corresponding `run --confirm` command remains mandatory.
