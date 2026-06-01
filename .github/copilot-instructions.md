# GitHub Copilot Instructions

This repository publishes the `review-fix-ship` Agent Skill for Codex and GitHub Copilot.

- Keep the installable skill under `skills/review-fix-ship/` so `gh skill install` and `gh skill publish` can discover it.
- Preserve the Agent Skills `SKILL.md` frontmatter fields `name` and `description`.
- Keep host-neutral workflow instructions in `SKILL.md`; put Codex and GitHub Copilot installation details in `references/hosts.md`.
- Keep `reviewctl.mjs` dependency-free and compatible with Node.js `>= 18` on macOS, Linux, and Windows.
- Preserve separate confirmation gates for workspace creation, local commit, push, and PR/MR creation.
- Treat `caveman`, `rtk`, CodeGraph, `gh`, and `glab` as optional tools. Detect them automatically, activate `caveman lite`, prefer explicit `rtk` wrappers for high-output reads, and record RTK route fallbacks declaratively. Keep `reviewctl` operations and Git writes raw.
- Never add automatic tool installation, force operations, destructive cleanup, or implicit remote submission.
- Run `node scripts/validate-skill.mjs`, `node --test skills/review-fix-ship/scripts/reviewctl.test.mjs`, and `node scripts/smoke-installed-skill.mjs` after changes.
- Keep user-facing usage and roadmap documentation under `docs/`, outside the publishable skill.
- Update `README.md` and `docs/usage.md` when behavior or installation guidance changes.
