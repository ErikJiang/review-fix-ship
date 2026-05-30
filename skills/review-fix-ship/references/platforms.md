# Platforms

## Baseline

Support native macOS, Linux, and Windows environments.

Require:

- Git with `git worktree` support
- Node.js `>= 18`
- A terminal capable of running `node`

Do not require Python, Bash, PowerShell, npm packages, `gh`, `glab`, `rtk`, or `codegraph` for the baseline local workflow.

## Invocation

macOS or Linux:

```bash
reviewctl="<skill-dir>/scripts/reviewctl.mjs"
node "$reviewctl" preflight --repo /path/to/repo
```

Windows PowerShell:

```powershell
$reviewctl = "<skill-dir>\scripts\reviewctl.mjs"
node "$reviewctl" preflight --repo C:\path\to\repo
```

The helper invokes Git directly with argument arrays. Do not wrap its commands in shell-specific parsing.

## Platform Notes

- Use repository-relative paths in findings and plans.
- Quote helper paths and repository paths because they may contain spaces.
- Prefer forward slashes in persisted repository-relative paths.
- Use Node path utilities for absolute filesystem paths.
- Avoid shell pipelines in deterministic helper logic.
- Treat WSL as Linux. Do not assume WSL paths are interchangeable with native Windows paths.

## Optional Tools

- `rtk` ships macOS and Linux binaries and a native Windows binary. Native Windows filters work, but its automatic Bash rewrite hook is limited; call `rtk` explicitly.
- CodeGraph supports Windows, macOS, and Linux on x64 and arm64. Its local `.codegraph/` index is repository-local.
- `caveman` has shell installers for macOS/Linux and a PowerShell installer for Windows. Installation and activation remain user-controlled.
