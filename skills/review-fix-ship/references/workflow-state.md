# Workflow State

## Storage

Store state outside the target repository:

```text
${REVIEW_FIX_SHIP_HOME:-${CODEX_HOME:-~/.codex}/review-fix-ship}/
  repos/<fingerprint>/runs/<run-id>/
```

The fingerprint derives from the Git common directory so linked worktrees share a run.

## Run State

The run-level sequence is:

```text
scoped -> findings_ready -> selected
```

Use one workspace record per selected finding after `selected`.

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
- `commit run` requires `commit_pending`.
- `push run` requires `push_pending`.
- `push preview` and `push run` require `HEAD` to equal the commit recorded by `commit run`; repeat self-review and commit approval after any branch change.
- `submit run` requires `submit_pending`.
- Repository file edits are allowed only after `plan_approved`.
- A branch-only workspace must be checked out manually before implementation or Git mutations.
- Never use force operations, destructive cleanup, or implicit remote submission.

Use `state mark` for non-mutating workflow milestones. `state mark --to commit_pending`, `push_pending`, or `submit_pending` records that the user has reached the matching approval discussion; the corresponding `run --confirm` command remains mandatory.
