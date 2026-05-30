# Repository Instructions

## Purpose

Maintain the reusable `review-fix-ship` Agent Skill for Codex and GitHub Copilot.

## Structure

- Keep the publishable skill under `skills/review-fix-ship/`.
- Keep the primary workflow in `skills/review-fix-ship/SKILL.md`.
- Put detailed, conditionally loaded guidance in `skills/review-fix-ship/references/`.
- Keep deterministic automation dependency-free in `skills/review-fix-ship/scripts/reviewctl.mjs`.

## Safety

- Preserve separate confirmation gates for workspace creation, commit, push, and PR/MR submission.
- Do not add automatic installs, force operations, resets, destructive cleanup, or implicit remote submission.
- Treat `caveman`, `rtk`, CodeGraph, `gh`, and `glab` as optional tools with graceful fallback.

## Validation

Run before committing:

```bash
node scripts/validate-skill.mjs
node --check skills/review-fix-ship/scripts/reviewctl.mjs
node --check skills/review-fix-ship/scripts/reviewctl.test.mjs
node --test skills/review-fix-ship/scripts/reviewctl.test.mjs
```

Update the root README and the skill README when installation paths, supported hosts, or public commands change.
