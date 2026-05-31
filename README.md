# review-fix-ship

`review-fix-ship` is a cross-platform Agent Skill for high-value code review, guarded fix planning, controlled implementation, self-review, and concise PR/MR preparation.

It supports:

- Codex
- GitHub Copilot cloud agent
- GitHub Copilot CLI
- GitHub Copilot agent mode in Visual Studio Code
- macOS, Linux, and Windows

The skill returns at most five verified review findings. After the user selects findings, it can create isolated branches or worktrees, render detailed action plans outside the target repository, implement only after plan approval, self-review the resulting diff, and prepare concise English PR or MR drafts. Local commit, push, and remote PR/MR creation each require separate confirmation.
Repair workspace start refs are stored separately from later PR or MR target branches, so fixes for `base...head` reviews start from `head` and target `base`.
Each mutating create or run is bound to its displayed preview with a one-time token.
Commit execution also rejects staged files unless they exactly match the explicit allowlist shown during commit preview.

## Install

GitHub CLI `gh skill` is currently in public preview and requires GitHub CLI `>= 2.90.0`.

Install for Codex:

```bash
gh skill install ErikJiang/review-fix-ship review-fix-ship --agent codex --scope user
```

Install for GitHub Copilot:

```bash
gh skill install ErikJiang/review-fix-ship review-fix-ship --agent github-copilot --scope user
```

For a project-scoped installation, omit `--scope user`. Several agents share `.agents/skills` at project scope.

Manual installation is also supported:

| Host | Personal skill directory |
| --- | --- |
| Codex | `~/.codex/skills/review-fix-ship/` |
| GitHub Copilot | `~/.copilot/skills/review-fix-ship/` or `~/.agents/skills/review-fix-ship/` |

GitHub Copilot project skill locations:

```text
.github/skills/review-fix-ship/
.claude/skills/review-fix-ship/
.agents/skills/review-fix-ship/
```

## Use

Example:

```text
Use $review-fix-ship to review main...feature and src/auth, return up to five
high-value findings, and ask me which findings to handle.
```

When a repository path and revision share a name, use `ref:<value>` or `path:<value>` to disambiguate the scope.

The full workflow, optional token-saving tools, platform notes, and manual commands are documented in [skills/review-fix-ship/README.md](skills/review-fix-ship/README.md).

## Token-Efficient Tools

The skill detects and uses these optional accelerators when available:

| Tool | Purpose |
| --- | --- |
| [caveman](https://github.com/JuliusBrussee/caveman) | Compress progress and summary responses |
| [rtk](https://github.com/rtk-ai/rtk) | Compress shell, Git, test, lint, and build output |
| [CodeGraph](https://github.com/colbymchenry/codegraph) | Reduce code exploration calls with a local semantic index |

All accelerators are optional. The skill does not install tools or modify global agent configuration automatically.

## Validate

```bash
node scripts/validate-skill.mjs
node --check skills/review-fix-ship/scripts/reviewctl.mjs
node --test skills/review-fix-ship/scripts/reviewctl.test.mjs
```

GitHub Actions runs the same checks on Ubuntu, macOS, and Windows.

When GitHub CLI `>= 2.90.0` is available, validate the preview publishing flow:

```bash
gh skill publish --dry-run
```

## Roadmap

See [skills/review-fix-ship/TODO.md](skills/review-fix-ship/TODO.md).

## License

A license has not been selected yet. Add a `LICENSE` file before the first public release.
