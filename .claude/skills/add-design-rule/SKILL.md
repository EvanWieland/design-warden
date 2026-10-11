---
name: add-design-rule
description: Add or change a deterministic Design Warden check (packages/source-analysis) end to end - check module, options schema, tests, policy rule and examples, benchmark labels and docs. Use when asked to detect a new kind of design violation or change what an existing check reports.
---

# Adding a design rule

A *rule* lives in a policy file. A *check* is the built-in code that verifies it. Most requests mean "write a new check, then reference it from a policy rule". First make sure a new check is needed: can an existing check with different `options` or `scope` express it? (For example, a font-size scale is `spacing-scale` with other `properties` and `tokenPrefix`.)

## Steps

1. **Write down the contract first**, in the check's doc comment:
   - What counts as a violation: the exact syntax shapes in TSX and CSS.
   - What is *insufficient evidence*, if anything: runtime values, spread props, computed class names.
   - What must not be reported: token definitions, the design system's own files, allowed keywords, comments and strings.
   - Which verdict each case gets: `violation`, `probable-violation` (heuristics), `insufficient-evidence` or `notice`.
2. **Implement** `packages/source-analysis/src/checks/<area>.ts` with `defineCheck({ id, engine: 'source', description, options: z.strictObject({...}), runFile | runProject })`.
   - Use the existing helpers: `styleValues()` for CSS and inline styles, `project.usages(file)` for resolved JSX, `project.definitions(file)`, `nearestToken()`, `snippetAt()`, and `fileFinding()` to build drafts.
   - `StyleValue` describes one property value: property, value (or the expression it came from), location, source and a few flags (`important`, `definesCustomProperty`, `wholeObject` with its `lead`). The sources are `css` (CSS and SCSS files, and Vue/Svelte `<style>` blocks), `css-in-js` (tagged templates), `jsx-style` (inline styles, including Vue/Svelte `style` attributes), `jsx-prop` (color-like props) and `jsx-class` (Tailwind arbitrary values).
   - Read styles through `styleValues()` only. Walking `file.css` yourself misses `<style>` blocks (`file.template.styles`), inline styles and CSS-in-JS. If a check needs another declaration-level fact, add a field to `StyleValue` in `declarationValues()` (`style-values.ts`), which every CSS source goes through.
   - Where things are skipped: the style checks skip the token source files themselves (`skipTokenSources` in `checks/style.ts`); the design system's own files are excluded with the policy rule's `scope.exclude`, not in code.
   - Return `FindingDraft`s with `origin: 'deterministic'` or `'heuristic'`, a `location` (include `endLine` for multi-line elements, because change scoping uses the span) and `code` evidence. Add a `suggestion` only when it is concrete and correct.
   - Never throw for bad input in a file. Parse errors are already reported as `analysis/unparseable-file`.
3. **Register** the check in the array exported from its module (for example `styleChecks`). It is picked up by `SOURCE_CHECKS` and validated at policy load.
4. **Unit tests** in `packages/source-analysis/test/checks.test.ts`, using `makeProject()` from `test/helpers.ts`: positives, negatives, and insufficient-evidence cases if the check has any.
   - `makeProject()` only runs rules that are in `TEST_POLICY` (`test/helpers.ts`), so add a rule for the new check there.
   - `TEST_POLICY` is shared with `packages/cli/test`, and `cli.test.ts` pins its rule count in the `policy validate` output: update that number.
5. **Policy:** add a rule to `apps/demo/design-warden.policy.json` that uses the check, with pass and fail `examples`. Run `pnpm check:demo`: the demo must stay clean and the examples must behave as declared. Examples are checked against the rule's scope, so a scope exclusion cannot be shown as a pass example. If the policy shape changed, run `pnpm schema`.
6. **Benchmark** (after the policy rule: the benchmark scores the corpus with the demo policy, so labels for a rule that is not in it all count as false negatives): add realistic cases to `fixtures/benchmark/src/bench/` with `@expect <rule-id>` markers on the reporting line, including at least one tricky negative. Run `pnpm eval`.
   - `pnpm eval` prints mismatches but exits 0. The pinned baseline in `tools/harness/test/benchmark.test.ts` is the gate: update its mismatch list and totals.
7. **Docs:**
   - an entry in `docs/rules.md`: what it reports, options, verdicts, known false positives and negatives;
   - every place that repeats the benchmark or the check count: the table, file count, insufficient-evidence share and history in `docs/evaluation.md`; the baseline sentence and "checks (N)" in `README.md`.
8. **Verify and record:** `pnpm typecheck && pnpm test`, then `pnpm scenario run all` (all `ok`). Record the commands and results in the progress log of `docs/PLAN.md`.

## Do not

- Do not regex-parse TSX or CSS. Use the AST and value parser.
- Do not decide outcomes in the check; `decideOutcome` in core does that.
- Do not change scenario expectations to make them pass.
