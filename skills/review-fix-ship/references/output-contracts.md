# Output Contracts

## Findings JSON

Record findings with:

```json
[
  {
    "id": "RF-001",
    "title": "Short problem statement",
    "severity": "high",
    "confidence": 92,
    "valueScore": 88,
    "evidence": [{ "path": "src/example.ts", "line": 42, "detail": "Concrete evidence" }],
    "trigger": "Input or runtime condition",
    "impact": "Material consequence",
    "example": {
      "scenario": "Short concrete reproduction",
      "observed": "Current incorrect behavior",
      "expected": "Correct behavior"
    },
    "recommendedFix": "Preferred repair",
    "alternativeFix": "Optional fallback",
    "validation": ["Focused regression test", "Relevant repository checks"]
  }
]
```

Requirements:

- Return an array with at most five entries.
- Use unique `id` values.
- Require `confidence >= 80`.
- Require at least one evidence entry with `path` and `detail`.
- Require non-empty `trigger`, `impact`, `recommendedFix`, and `validation`.
- Require `example.scenario`, `example.observed`, and `example.expected`.

## Action Plan

Render one plan for the active finding. Include evidence, the concise example, workspace branch, implementation steps, expected files, tests, completion criteria, and approval status. Save the authoritative plan outside the repository and mirror it under `.review-fix-ship/runs/<run-id>/workspaces/<finding-id>/plan.md`.

## Self-Review

Write authoritative `self-reviews/<finding-id>.md` after implementation and mirror it to `.review-fix-ship/runs/<run-id>/workspaces/<finding-id>/self-review.md`. Include:

- Diff reviewed
- Checks executed and outcomes
- Issues found during self-review
- Adjustments made
- Residual risks

## PR or MR Draft

Generate concise English text:

```text
type(scope): concise summary

## Summary
...

## Changes
- ...

## Testing
- ...
```

Add `## Risk` only when useful. Prefer the repository's own template when available.
Mirror rendered drafts to `.review-fix-ship/runs/<run-id>/workspaces/<finding-id>/change-request-<provider>.md`.
