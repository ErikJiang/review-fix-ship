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

## Action Plan

Render one plan per selected finding. Include evidence, workspace branch, implementation steps, expected files, tests, completion criteria, and approval status. Save plans outside the repository.

## Self-Review

Write `self-reviews/<finding-id>.md` after implementation. Include:

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
