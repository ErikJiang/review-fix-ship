# Repository Instructions

## Purpose

Maintain the reusable `review-fix-ship` Agent Skill for Codex and GitHub Copilot.

## Structure

- Keep the publishable skill under `skills/review-fix-ship/`.
- Keep the primary workflow in `skills/review-fix-ship/SKILL.md`.
- Put detailed, conditionally loaded guidance in `skills/review-fix-ship/references/`.
- Keep deterministic automation dependency-free in `skills/review-fix-ship/scripts/reviewctl.mjs`.
- Keep user-facing usage and roadmap documents under `docs/`, outside the publishable skill.

## Safety

- Preserve separate confirmation gates for workspace creation, commit, push, and PR/MR submission.
- Do not add automatic installs, force operations, resets, destructive cleanup, or implicit remote submission.
- Treat `caveman`, `rtk`, CodeGraph, `gh`, and `glab` as optional tools with graceful fallback.
- Prefer `caveman lite` and explicit `rtk` wrappers when detected. Keep `reviewctl` operations and Git writes raw, and record RTK route fallbacks declaratively.

## Validation

Run before committing:

```bash
node scripts/validate-skill.mjs
node --check skills/review-fix-ship/scripts/reviewctl.mjs
node --check skills/review-fix-ship/scripts/reviewctl.test.mjs
node --test skills/review-fix-ship/scripts/reviewctl.test.mjs
node scripts/smoke-installed-skill.mjs
```

Update the root README and `docs/usage.md` when installation paths, supported hosts, or public commands change.
