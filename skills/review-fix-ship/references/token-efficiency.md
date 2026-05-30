# Token Efficiency

Use optional accelerators when available. Never make review correctness depend on them.

## Detect

Run:

```text
node "<skill-dir>/scripts/reviewctl.mjs" tools status --repo <repo>
```

`preflight` also includes the same capability matrix. Snapshot it into the run state with `scope normalize`.

## Decision Table

| Need | Preferred path | Fallback |
| --- | --- | --- |
| Concise user-facing progress | Activate installed `caveman` concise mode | Keep replies concise manually |
| Git status, diff, log, shell search, file reads | Explicit `rtk` wrapper | Native command |
| Test, lint, and build output | Matching `rtk` wrapper or `rtk test <cmd>` | Repository-native command |
| Architecture discovery | CodeGraph MCP `codegraph_context` or `codegraph_explore` | `codegraph context`, then native search |
| Locate symbols | CodeGraph MCP `codegraph_search` | `codegraph query`, then `rg` |
| Trace behavior | CodeGraph MCP `codegraph_trace`, `codegraph_callers`, or `codegraph_callees` | CLI callers/callees, then targeted reads |
| Estimate edit blast radius | CodeGraph MCP `codegraph_impact` | `codegraph impact`, then native search |
| Select focused tests | `codegraph affected` | Existing repository test conventions |

## Rules

### caveman

- Use it only for response compression.
- Preserve full review evidence, plan details, validation records, and approval questions.
- Do not install or activate repository-wide rule files automatically.

### rtk

- Prefer explicit commands such as `rtk git status`, `rtk git diff`, `rtk grep`, `rtk read`, `rtk test <cmd>`, and ecosystem-specific wrappers.
- On native Windows, call `rtk` explicitly because automatic Bash rewriting is limited.
- Keep `reviewctl` helper operations on raw Git so state guards and command outcomes remain deterministic.
- When compressed output hides a failure detail, read RTK's tee file or rerun the narrow command without RTK.

### CodeGraph

- Prefer active CodeGraph MCP tools over grep/read exploration loops.
- Trust indexed structural results unless CodeGraph reports staleness.
- Run `codegraph status` before using CLI queries.
- If `.codegraph/` is absent, ask before running `codegraph init -i`; initialization writes a local index into the repository directory.
- Use native search for unsupported languages, generated files, or stale content requiring direct verification.

## Installation Boundary

Detection is automatic. Installation and global agent configuration are not. If a tool is absent, continue with the fallback and mention the optional install URL only when the user would benefit.
