---
name: evaluate-findings
description: Triage Design Warden findings and measure detection quality - decide whether a finding is a true or false positive, record misses as labelled benchmark cases or scenarios, and run the deterministic and semantic evaluations. Use when a report looks wrong, after changing a check, or when asked about precision and recall.
---

# Evaluating findings

## Reading one finding

- `verdict` is what the engine concluded. `confidence` is how sure it is. `enforcement` (from the rule) is what CI does. `outcome` is the result of the single mapping in `decideOutcome`.
- `origin`: `deterministic` is exact; `heuristic` is deterministic but approximate (provenance, name matching); `ai` is model output that was verified against the files shown and is capped at review.
- `preexisting: true` means the finding lies outside the changed lines, so it is informational. Check the scope (`--scope`) before calling it a false positive.
- AI findings: read `report.semantic.rejected` for references that failed verification.

## Classifying

1. Reproduce: `pnpm design-warden check --policy … --base … --format json`, or `pnpm scenario run <id>`.
2. Decide against the rule's *description*, not against what you would prefer:
   - **False positive:** the rule's intent is not violated. Fix the check, or narrow the rule's scope or options.
   - **False negative:** a real violation went unreported. Fix the check, or document it as a limitation.
   - **Insufficient evidence** is correct when the value really is decided at runtime.

## Recording

- Add a labelled case to `fixtures/benchmark/src/bench/` (`@expect <rule-id>` on the reporting line). Keep deliberate traps that document known false positives. Then run `pnpm eval`, and update the pinned baseline in `tools/harness/test/benchmark.test.ts` and `docs/evaluation.md` together.
- For change-dependent behaviour (provenance, shared changes, policy edits), add or extend a scenario in `fixtures/scenarios/`. Write `expected` by hand from the intended behaviour, before running it.

## Evaluating the model reviewer

- `pnpm eval:semantic` (replay) checks the pipeline. `pnpm eval:semantic --provider anthropic` measures a live model against the hand-written `expected.semantic` labels: label recall, false alarms on clean code, and reference rejection rate. It costs money, and sends changed demo files to the provider.
- Never let model output produce or update labels.
