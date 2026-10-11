# Evaluation

Three evaluations, kept separate on purpose:

1. **Scenarios:** does the whole pipeline reach the right outcome on realistic changes?
2. **Deterministic benchmark:** per-rule precision and recall on labelled snippets.
3. **Semantic evaluation (opt-in):** how a real model performs against hand-written labels.

A model never grades its own output: every expectation and label is written by hand in the repository.

All numbers below were produced on 2026-10-10 on Windows 11, Node 24.21 and Chromium (Playwright 1.64), by the commands shown. Re-run them to reproduce. They are a baseline for this repository's demo and corpus, not a claim about arbitrary codebases.

## 1. Seeded scenarios

`fixtures/scenarios/<id>/` contains:
- `scenario.json`: description and **expected** outcome, findings, provenance and semantic labels, written by hand;
- `overlay/` and `edits.json`: the change, applied to a copy of `apps/demo`;
- `semantic-replay.json` (optional): a recorded model response.

| # | Scenario | Kind | Expected outcome | What it demonstrates |
|---|---|---|---|---|
| 0 | `compliant-change` | clean | pass | Correct change, no findings (false-positive baseline) |
| 1 | `hardcoded-color` | violation | fail | `color/semantic-tokens`; suggestion `--color-text-danger` |
| 2 | `unapproved-spacing` | violation | fail | `spacing/scale` ×2 with nearest steps |
| 3 | `raw-control` | violation | fail | Raw `<button>` → use `<Button>` |
| 4 | `incomplete-state` | violation | fail | `DataTable` without `status` and `emptyState` |
| 5 | `custom-reimplementation` | review | review | `OrderStatusPill` re-implements `Badge` (preferred → review, not fail) |
| 6 | `token-change` | review | review | Two primitive tokens change → 7 tokens and 10 usages listed; with `--visual`, every affected screen |
| 7 | `new-pattern` | legitimate deviation | review | Novel `ActivityTimeline`: review requested, **no blocking finding** |
| 8 | `insufficient-evidence` | review | review | Avatar color from runtime data → "insufficient evidence" |
| 9 | `agent-evasion` | security | fail | Inline suppression of a mandatory rule rejected; injection comment ignored; fabricated model citation rejected (with `--semantic replay`) |
| 10 | `policy-weakening` | security | fail | Change downgrades the color rule; `--policy-ref` keeps the gate, and the edit is reported |

Comparison is strict: every expected finding must appear, and **any other** active deterministic finding counts as a mismatch, which is how false positives show up.

```bash
pnpm scenario run all
```

Result: **11/11 match their expectations** (11 s for all eleven on 2026-10-11, including process start-up). The same check runs in the test suite (`tools/harness/test/scenarios.test.ts`).

Visual mode: `pnpm scenario run token-change --visual` (16 captures per side, 2 viewports).

| Measure | Result |
|---|---|
| `token-change` | 8 of 8 route-states changed, each with labelled regions |
| `unapproved-spacing` (no visible change) | 16/16 captures `unchanged` across two separate builds, so no flakiness observed |
| Wall time, cold (base build and capture included) | ~35 s (2026-10-11, Windows 11) |
| Wall time, warm base cache | ~22 s (comparison itself 5–6 s, accessibility included) |

## 2. Deterministic benchmark

`fixtures/benchmark/src/bench/` holds 28 files of realistic snippets, analysed with the demo policy. An `@expect <rule-id>` marker (optionally `x<n>`) labels each finding expected on that line. The corpus deliberately includes:

- **Tricky negatives**: allowed keywords, `url(#id)`, percentages, non-spacing lengths, `calc()` multipliers, hidden and radio inputs, data constants, wrappers that use the real component, `!important` inside comments, strings and `url()`, relative font sizes (including `em`, which the typography rule leaves out) and lengths in other properties, Tailwind classes that use tokens, theme classes, and class-like strings outside class names, CSS-in-JS mixins (also followed by a comment), selector interpolations and non-style tagged templates, Sass variables built from tokens, mixins without arguments (also with empty parentheses) and content-block mixins, and Vue and Svelte components that pass required props through kebab-case, shorthand (Vue `:tone`), bound values, spreads or a Svelte snippet.
- **Three traps for the name heuristic**:
  - `NoticeBoard` and `PanelGrid` contain an alias, but not as the head noun, so they are not flagged.
  - `PivotTable` ends in the alias "Table", so it is flagged. It is a known false positive, kept to measure the heuristic's limit.
- **Audit cases** (`AuditCases.tsx`, `audit.css`): the misses found by the 2026-10-10 false-positive/false-negative review. They cover type casts, local style objects, conditional color props, `??` fallbacks, `var()` fallbacks, translucent colors, token redefinition, dynamic input types and ARIA-role imitations. They were written after the fixes, so they guard against regressions; they are not an estimate of accuracy.
- **Known limitations:** the `font` shorthand in `typography.css` is not read, so it is a known false negative. `Limitations.tsx` holds former limitations (CSS-in-JS, Tailwind), kept as regression cases.

A finding matches when (rule, file, line) are equal. Findings marked `notice` and inline-suppressed findings are not counted.

```bash
pnpm eval     # prints the table and writes .design-warden/eval/benchmark.json
```

Baseline:

| Rule | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| `color/semantic-tokens` | 56 | 0 | 0 | 100.0% | 100.0% |
| `components/design-system-controls` | 10 | 0 | 0 | 100.0% | 100.0% |
| `components/prop-contracts` | 18 | 0 | 0 | 100.0% | 100.0% |
| `components/reuse-existing` (heuristic) | 3 | 1 | 0 | 75.0% | 100.0% |
| `policy/inline-exception-rejected` | 2 | 0 | 0 | 100.0% | 100.0% |
| `spacing/scale` | 42 | 0 | 0 | 100.0% | 100.0% |
| `styles/no-important` | 10 | 0 | 0 | 100.0% | 100.0% |
| `tokens/semantic-only` | 15 | 0 | 0 | 100.0% | 100.0% |
| `typography/scale` | 15 | 0 | 1 | 100.0% | 93.8% |
| **All** | **171** | **1** | **1** | **99.4%** | **99.4%** |

- **Location accuracy:** 0 location misses (every reported finding of the right rule is on the labelled line).
- **Insufficient evidence:** 15.1% of counted findings are `insufficient-evidence`. They are runtime values the engine refuses to guess about.
- **Latency:** the source engine analyses the corpus in 140–210 ms; a full scan of the demo (49 source files) takes 160–190 ms (2026-10-11). It was ~40 ms and ~80–130 ms before the backlog added the Tailwind, CSS-in-JS, SCSS, Vue and Svelte readers.
- **History:** before the review the corpus had 12 files and 52 labels, scored 49/2/3 (96.1% precision, 94.2% recall). Both traps that were false positives then are now correct negatives. The new audit labels add the rest of the change. Since then: `no-important` added `important.css` (6 labels, all hits); `typography/scale` added `typography.css` (7 labels, one a known miss) and one insufficient-evidence label in `AuditCases.tsx`; Tailwind arbitrary values added `Tailwind.tsx` (14 labels, all hits) and turned the two Tailwind misses in `Limitations.tsx` into hits; CSS-in-JS templates added `CssInJs.tsx` (11 labels, all hits, three of them for an unparseable template) and turned the last miss in `Limitations.tsx` into a hit; SCSS added `styles.scss` (11 labels, all hits), and with postcss-scss the `//`-commented template in `CssInJs.tsx` now parses (its three insufficient-evidence labels became one hit, and an unmatched-brace template keeps that case); Vue and Svelte added `VueOrders.vue` and `SvelteOrders.svelte` (6 labels each, all hits). The fixes after the 2026-10-11 review added 9 labels, all hits: a class constant and `classNames()` in `Tailwind.tsx`; a namespaced `<DS.Badge>` and `!important` in an inline style and a `<style>` block in `VueOrders.vue`; a namespaced component and an inline style mixing literals and `{…}` in `SvelteOrders.svelte`; `!important` in a CSS-in-JS template. Tricky negatives cover the rest (an `em` font size, `@include truncate()`, a mixin followed by a comment, Vue's `:tone` shorthand, a Svelte snippet prop). Like the audit cases, they were written after the fixes. CSS-in-JS object styles added `CssInJsObjects.tsx` (10 labels, all hits): nine for object styles and `sx`, and one `components/reuse-existing` for a hand-made copy of the design system's `Stack`. Default-palette color classes added 5 `tokens/semantic-only` labels in `Tailwind.tsx`, all hits. One of them is `text-slate-700`, a tricky negative until then, when theme classes were not judged: the demo has no `--color-slate-700`, so the class now counts as a token reference that bypasses the design system. Globally registered Vue components added `vue-globals.ts` (an `app.component` registration) and `VueGlobals.vue` (3 `components/prop-contracts` labels, all hits, with both tag spellings as negatives). The fixes after the finishing review added 13 labels from the detection audit's cases, all hits: `sx` breakpoints, computed keys, map lookups and a numeric `fontSize` in `CssInJsObjects.tsx`; a class map and `cva()` in `Tailwind.tsx`; a namespace registration in `VueGlobals.vue`. They also added tricky negatives: `tailwind.css` (the entry stylesheet that makes the corpus a Tailwind project), `utilities.css` (a project-defined `.border-white`), and local registrations in `VueOptionsLocal.vue` and `VueSetupLocal.vue`.

The exact mismatch list is pinned in `tools/harness/test/benchmark.test.ts`. That test is the regression guard for known false positives and negatives: fixing one, or introducing one, fails the test until the labels and this table are updated together.

### Caveats

- The corpus and the checks were written by the same team. Expect lower recall on unfamiliar code. The `findings-auditor` agent (`.claude/agents/`) exists to hunt for new cases.
- Provenance and shared-change impact need a change set, so they are evaluated through scenarios, not the benchmark. When tree shape became a second provenance signal (2026-10-10), all 11 scenarios kept their expected classifications. Only similarity values moved, for example `SettingsPage` 0.88 → 0.75 in `insufficient-evidence` and `CustomersPage` 0.44 → 0.40 in `incomplete-state`. The cases the signal adds (a rearranged component, a new layout from a pattern's components) are unit tests in `packages/source-analysis/test/changes.test.ts`.

### Known failure modes

- **False negatives:**
  - colors and spacing in CSS-in-JS object styles, and Tailwind theme classes (the Tailwind config is not read);
  - values hidden behind props passed to components that themselves apply them;
  - token misuse by role, for example a background token used for text.
- **False positives:**
  - component names whose head noun is an alias by coincidence, such as `PivotTable` (`duplicate-component` is heuristic and capped at review);
  - provenance "modified" notices on any structural edit to a page.
- **Uncertainty:** runtime-computed styles become "insufficient evidence" (review) by design.

## 3. Semantic evaluation (opt-in)

Labels live in `scenario.json` under `expected.semantic` (`mustInclude` rule and verdict pairs, `noViolations` for clean changes). Four scenarios are labelled.

```bash
pnpm eval:semantic                       # recorded responses: checks the pipeline, not model quality
pnpm eval:semantic --provider anthropic  # live: sends the scenarios' changed files to the API; costs money
```

| Metric | Replay (pipeline check) | Live model |
|---|---|---|
| Label recall | 3/3 | **not measured here**: no API key was available in this environment |
| False alarms on the clean change | 0 | not measured |
| Reference rejection rate (rejected / all) | 40% (2 of 5; both rejections are deliberate fabrications in the `agent-evasion` recording) | not measured |
| Engine failures | 0 | not measured |
| Tokens / cost | 0 | reported per run when live |

The provider code paths are tested against local mock servers: the Anthropic SDK streaming request and its error mapping, and OpenAI-compatible requests and errors. The live-model numbers are the main open evaluation item ([OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)).

## Reproducing everything

```bash
pnpm install && pnpm exec playwright install chromium
pnpm test             # includes scenarios, the benchmark baseline and real-browser visual tests
pnpm scenario run all
pnpm eval
pnpm eval:semantic
```
