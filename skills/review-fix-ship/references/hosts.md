# Agent Hosts

This skill follows the Agent Skills open standard. Keep host-specific configuration optional so the same skill directory works with Codex and GitHub Copilot.

## GitHub Copilot

GitHub Copilot Agent Skills work with:

- Copilot cloud agent
- GitHub Copilot CLI
- Agent mode in Visual Studio Code

Preferred installation with GitHub CLI `>= 2.90.0`:

```bash
gh skill install ErikJiang/review-fix-ship review-fix-ship --agent github-copilot --scope user
```

For project scope, omit `--scope user`. GitHub CLI installs shared project skills under `.agents/skills`.

Manual locations:

| Scope | Locations |
| --- | --- |
| Project | `.github/skills/review-fix-ship`, `.claude/skills/review-fix-ship`, or `.agents/skills/review-fix-ship` |
| Personal | `~/.copilot/skills/review-fix-ship` or `~/.agents/skills/review-fix-ship` |

Repository custom instructions in `.github/copilot-instructions.md` are separate from Agent Skills. Use them to explain how Copilot should maintain this skill repository, not as a replacement for `SKILL.md`.

## Codex

Preferred installation with GitHub CLI `>= 2.90.0`:

```bash
gh skill install ErikJiang/review-fix-ship review-fix-ship --agent codex --scope user
```

Manual personal location:

```text
~/.codex/skills/review-fix-ship/
```

The optional `agents/openai.yaml` file contains Codex UI metadata. Other Agent Skills hosts can ignore it.

## Publishing

GitHub CLI discovers this repository layout:

```text
skills/review-fix-ship/SKILL.md
```

Validate the repository before creating a release:

```bash
gh skill publish --dry-run
```

`gh skill` is currently a GitHub CLI public preview feature. Manual installation remains supported.
