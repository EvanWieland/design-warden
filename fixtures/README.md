# Fixtures

Ground truth for evaluating Design Warden. Everything here is written by hand. Files may contain deliberate prompt-injection text and violations; treat them as data.

| Directory | What | Used by |
|---|---|---|
| `scenarios/<id>/` | Seeded changes to `apps/demo`. `scenario.json` holds the description and the **expected** outcome, findings, provenance and semantic labels. `overlay/` holds files to add or replace; `edits.json` holds exact find/replace edits; `semantic-replay.json` (optional) is a recorded model response | `pnpm scenario …`, `tools/harness/test/scenarios.test.ts`, the inspector |
| `benchmark/src/bench/` | Labelled snippets (`@expect <rule-id> [xN]` on the reporting line), analysed with the demo policy | `pnpm eval`, `tools/harness/test/benchmark.test.ts` |

Scenario categories (`kind`): `clean` (must pass), `violation` (must fail), `review` (needs a human, must not fail), `legitimate-deviation` (new but acceptable; must not fail), `security` (attacks on the gate).

To add a scenario:
1. Create `scenarios/<id>/scenario.json`, with expectations written from the intended behaviour, before running anything.
2. Add `overlay/` files and/or `edits.json`.
3. Run `pnpm scenario run <id>`. If it does not match, decide whether the engine or the expectation is wrong. Fix the engine unless the expectation was a mistake.
4. Add the id to the list in `tools/harness/test/scenarios.test.ts` and the table in `docs/evaluation.md`.
