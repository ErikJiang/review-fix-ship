# Review Rubric

## Candidate Passes

Perform independent passes over the normalized diff and filtered files:

| Pass | Look for |
| --- | --- |
| Correctness | Wrong conditions, invalid state transitions, race conditions, error-path defects, resource leaks |
| Security | Trust-boundary mistakes, injection, authorization gaps, secret exposure, unsafe deserialization |
| Reliability and performance | Retry hazards, unbounded work, N+1 operations, excessive allocation, timeout or concurrency defects |
| API and data contract | Breaking schema changes, incompatible defaults, missing validation, migration risks |
| Test gaps | Missing regression coverage for a concrete changed behavior or failure mode |

## Verification

Verify every candidate independently before presenting it:

1. Point to a repository-relative file and line, diff hunk, or reproducible command.
2. Describe the triggering input, execution path, or operational condition.
3. Explain the user, data, security, or maintenance impact.
4. Reject findings already prevented by nearby code, framework behavior, or existing tests.
5. Reject style-only preferences, broad refactors without a defect, and speculative concerns.

## Ranking

Set `confidence` from `0` to `100`; keep only `>= 80`.

Set `valueScore` from `0` to `100` using:

| Factor | Weight |
| --- | ---: |
| Severity and user impact | 35 |
| Blast radius | 20 |
| Reproducibility and evidence | 20 |
| Fix leverage | 15 |
| Regression risk if ignored | 10 |

Return at most five verified findings globally. If fewer than five qualify, return fewer than five.

Use severities `critical`, `high`, `medium`, or `low`. Reserve `low` for concrete issues with meaningful leverage; do not use it to pad the list.
