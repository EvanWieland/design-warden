# ADR 0001: Deterministic engines gate merges; model findings can only request review

Status: Accepted, 2026-10-10

## Context

The tool exists because coding agents follow design guidance unreliably. If a model decides what passes, the verifier inherits the same weakness. Model review also has low measured precision: on SWR-Bench the best tool reached F1 18.7%. And it is exposed to prompt injection from repository content: adaptive attacks succeed over 90% of the time, and there are real incidents (CamoLeak, a PR title that leaked an API key). See [ai-review.md](../research/ai-review.md).

## Decision

- Blocking outcomes come only from deterministic checks. Source checks always count; visual checks count only when a rule's enforcement allows.
- A model finding's outcome is capped at `review`. This is enforced twice:
  - the policy schema rejects `verify.by: semantic` with `enforcement: block`;
  - `decideOutcome()` caps `origin: ai` findings at review.
- A visual difference is evidence that something changed, so it requests review. It is never a violation by itself.
- Confidence is never an input to blocking. Blocking depends on the verdict and the rule's enforcement only.
- A failed or skipped engine is always visible in the report, with a reason. What a failure does to the outcome is explicit policy (`failurePolicy`): `fail-closed` by default for source, `review` for visual and semantic.

## Consequences

- CI results are reproducible without a model: the default suite and the default CI path need no network.
- A model can produce noise, which costs review time, but it cannot merge or block code on its own.
- Teams that want stricter gating use `--fail-on review`, which still involves a human rather than a model.

## Alternatives considered

- **Confidence threshold for AI blocking:** rejected. The model reports its own confidence, and the brief rules this out.
- **AI-only review:** rejected for the precision and injection reasons above.
