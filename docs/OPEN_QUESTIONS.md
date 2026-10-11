# Open questions

Questions this repository could not settle, what each affects, and the fallback chosen meanwhile.

| # | Question | Impact | Current fallback |
|---|---|---|---|
| 1 | How stable is capture on real applications (fonts, lazy images, virtualised lists, third-party widgets)? Only toy pages and the demo were tested. | Spurious visual review requests | Deterministic preset, stability loop and `mask` selectors; diffs never block |
| 2 | Is 0.02 the right pixelmatch threshold across palettes, including dark themes? | Missed or noisy visual changes | Calibrated on adjacent Tailwind shades; configurable per rule; benchmark to extend |
| 3 | Do Jaccard fingerprints classify provenance well beyond the demo? | Novel patterns misclassified as established, or the reverse | Heuristic origin, capped at review, thresholds configurable; since B15 composition and tree shape (tree edit distance) must both agree. Untested on large real codebases |
| 4 | How do vLLM and LM Studio treat unsupported JSON Schema keywords under `strict`? | Provider errors or unconstrained output | The schema avoids unsupported keywords; all output is validated locally |
| 5 | Real-model precision and recall on the scenario corpus? No API key was available here, and on 2026-10-11 the requester chose not to run the live evaluation. | Usefulness of semantic review is unmeasured | Replay fixtures exercise the full pipeline; `pnpm eval:semantic` is opt-in |
| 6 | Will the TypeScript 7.1 API (spawn-based) make type-aware checks practical, e.g. resolving prop types or token types through aliases? | Recall on indirect values | Babel AST with explicit "insufficient evidence" findings for dynamic values |
| 7 | Should CSS-in-JS, SCSS and Tailwind be first-class, or delegated (e.g. to `@shadcn/lint` via an import adapter)? | Coverage in many enterprise codebases | Tailwind arbitrary values, CSS-in-JS templates and SCSS are read natively (2026-10-10); Tailwind theme classes need the Tailwind config, which is not read |
| 8 | Should accepted review requests be remembered across pushes, e.g. approved fingerprints in a file? | Repeated review requests on the same PR | Decided in [ADR 0012](decisions/0012-approvals.md): `approvals[]` in the policy, read from the trusted policy source, review findings only, required expiry. Per-PR memory is left to code-scanning dismissals |
| 9 | Does the Anthropic server-side fallback change data-handling terms for a given organisation, e.g. zero data retention? | Compliance | Report records the serving model; fallbacks can be removed in `providers/anthropic.ts`; documented in security.md |
| 10 | Is the GitHub annotation cap (10 per level per step) still current? It is documented only in actions/toolkit. | Missing annotations | Ranked and truncated; summary and JSON report carry everything |
| 11 | ~~Does the example workflow run on GitHub as written?~~ Answered on 2026-10-11: yes. A test pull request ran the `check` and `visual` jobs as designed (see [ci-integration.md](ci-integration.md#the-example-workflow)); only the `semantic` job's live path is unexercised, for want of a key. | A broken first run for adopters | Every command was run locally in a scratch repository; ci-integration.md says what is untested |
