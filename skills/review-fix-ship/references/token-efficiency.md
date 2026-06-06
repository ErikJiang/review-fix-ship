# Token Efficiency

Use optional accelerators when available. Never make review correctness depend on them. Do not install tools, run `rtk init`, or modify global agent configuration automatically.

## Detect and Activate

Run:

```text
node "<skill-dir>/scripts/reviewctl.mjs" tools status --repo <repo>
node "<skill-dir>/scripts/reviewctl.mjs" tools policy --repo <repo>
node "<skill-dir>/scripts/reviewctl.mjs" review start --repo <repo> --scope <scope>
```

`preflight` also includes the same capability matrix and execution policy. `review start` is the default exploration gate: it normalizes scope, snapshots the policy into run state, records active modes, and reports whether CodeGraph is ready or requires approval for `codegraph init -i`. `scope normalize` and `efficiency activate` remain available for recovery or advanced scripting. Default to `caveman lite` and explicit `rtk` wrappers; missing tools degrade to manual concise responses and native commands.

## Decision Table

| Need | Preferred path | Fallback |
| --- | --- | --- |
| Concise user-facing progress | Activate installed `caveman` in `lite` mode | Keep replies concise manually |
| Git status, log, show | `rtk git status`, `rtk git log`, `rtk git show` | Narrow native Git read |
| Diff | `rtk git diff` | Targeted native `git diff` |
| Search | `rtk grep` | `rg` |
| File reads | `rtk read` | Targeted native read |
| File listings | `rtk ls` or `rtk find` | Native listing |
| Tests | Matching wrapper or `rtk test <cmd>` | Repository-native test command |
| Lint, build, validation | Matching wrapper or `rtk err <cmd>` | Repository-native command |
| Manual provider reads | `rtk gh` or `rtk glab` | Native provider CLI |
| Architecture discovery | CodeGraph MCP `codegraph_context` or `codegraph_explore` | `codegraph context`, then native search |
| Locate symbols | CodeGraph MCP `codegraph_search` | `codegraph query`, then `rg` |
| Trace behavior | CodeGraph MCP `codegraph_trace`, `codegraph_callers`, or `codegraph_callees` | CLI callers/callees, then targeted reads |
| Estimate edit blast radius | CodeGraph MCP `codegraph_impact` | `codegraph impact`, then native search |
| Select focused tests | `codegraph affected` | Existing repository test conventions |

## Rules

### caveman

- Default to `lite`. Use it only for progress and summary compression.
- Preserve full review evidence, plan details, validation records, approval questions, warnings, diagnostics, commit messages, and PR or MR drafts.
- Do not install or activate repository-wide rule files automatically.

### rtk

- Prefer explicit commands such as `rtk git status`, `rtk git diff`, `rtk grep`, `rtk read`, `rtk test <cmd>`, `rtk err <cmd>`, and ecosystem-specific wrappers.
- On native Windows, call `rtk` explicitly because automatic Bash rewriting is limited.
- Keep `reviewctl` helper operations, provider calls inside `remote fetch`, and Git writes on raw commands so guards and cached outputs remain deterministic.
- When compressed output hides a failure detail, rerun the narrow command without RTK and record `detail-hidden`.

Record the first successful use of each route. Record every fallback:

```text
node "<skill-dir>/scripts/reviewctl.mjs" efficiency record --repo <repo> --run-id <run-id> --route rtk-search --outcome used
node "<skill-dir>/scripts/reviewctl.mjs" efficiency record --repo <repo> --run-id <run-id> --route rtk-test --outcome fallback --reason detail-hidden
node "<skill-dir>/scripts/reviewctl.mjs" efficiency status --repo <repo> --run-id <run-id>
```

Routes:

```text
rtk-git-read
rtk-diff
rtk-search
rtk-file-read
rtk-file-list
rtk-test
rtk-lint
rtk-build
rtk-provider-read
```

Fallback reasons:

```text
tool-unavailable
unsupported-command
wrapper-failed
detail-hidden
raw-required
```

Always use raw commands for:

```text
node "<skill-dir>/scripts/reviewctl.mjs" ...
git add
git commit
git push
git branch
git worktree
```

### CodeGraph

- Prefer active CodeGraph MCP tools over grep/read exploration loops.
- Trust indexed structural results unless CodeGraph reports staleness.
- Run `codegraph status` before using CLI queries.
- If `.codegraph/` is absent, ask before running `codegraph init -i`; initialization writes a local index into the repository directory.
- If the user does not approve initialization, continue with native search and record the applicable fallback reason for the RTK route you used instead.
- Use native search for unsupported languages, generated files, or stale content requiring direct verification.

## Installation Boundary

Detection is automatic. Installation and global agent configuration are not. If a tool is absent, continue with the fallback and mention the optional install URL only when the user would benefit.

## Audit Boundary

Audit is declarative: `efficiency record` writes selected routes and fallback reasons but never executes shell commands. `rtk gain` is optional and not part of the required workflow because constrained environments may deny access to RTK's tracking database.
