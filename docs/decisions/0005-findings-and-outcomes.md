# ADR 0005: One function maps findings to CI consequences

Status: Accepted, 2026-10-10

## Context

Findings come from deterministic checks, heuristics, screenshots and models. Mixing up "how bad", "how sure" and "what CI does" is the usual way tools end up with arbitrary thresholds.

## Decision

- Engines emit `FindingDraft`s: rule id, **verdict**, **confidence**, origin (`deterministic`, `heuristic` or `ai`), message, location, evidence and suggestion.
  - Verdicts: `violation`, `probable-violation`, `acceptable-deviation`, `insufficient-evidence` or `notice`.
- `finalizeFindings()` in core does the rest:
  - attaches rule metadata and guidance;
  - applies policy exceptions and inline suppressions;
  - marks findings outside the change as pre-existing;
  - assigns a stable fingerprint id (rule + file + evidence text);
  - calls `decideOutcome()`.
- `decideOutcome()` is the single mapping:
  - `violation` → the enforcement ceiling (block → `fail`, review → `review`, report → `info`);
  - `probable-violation` and `insufficient-evidence` → at most `review`;
  - `acceptable-deviation` and `notice` → `info`;
  - suppressed or pre-existing → `info`;
  - `origin: ai` → at most `review`.
- The overall outcome is `error` if an engine that must fail closed failed; otherwise `fail` if any finding fails; otherwise `review` if any finding needs review or an engine with failure mode `review` failed; otherwise `pass`.
- Exit codes are a stable contract:

  | Exit | Meaning |
  |---|---|
  | 0 | pass, or review (exit 1 instead with `--fail-on review`) |
  | 1 | fail |
  | 2 | usage error or invalid policy |
  | 3 | an engine failed and its failure mode is `fail-closed` |

## Consequences

- Policy semantics live in one tested function, not in each engine.
- `insufficient-evidence` is a first-class result: the tool says "I can't tell" instead of guessing.

## Alternatives considered

Per-engine outcome logic was rejected because the engines would drift apart. Numeric scores were rejected because they are not explainable.
