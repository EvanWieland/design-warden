# Landscape: what exists, what we reuse, what is different

Last verified: 2026-10-10. This is the synthesis. Each topic note next to this file holds the detailed findings, every claim tagged *Verified*, *Inferred* or *Unresolved*, and the source links:

| Topic | Note |
|---|---|
| Visual regression and screenshot review | [visual-regression.md](visual-regression.md) |
| Frontend static analysis and token enforcement | [static-analysis-and-tokens.md](static-analysis-and-tokens.md) |
| Design-system contracts and metadata | [design-contracts.md](design-contracts.md) |
| AI review, structured outputs, prompt injection | [ai-review.md](ai-review.md) |
| GitHub Actions, annotations, report formats | [ci-integration.md](ci-integration.md) |
| Design linting, a11y, governance, AI-UI prior art | [prior-art-and-governance.md](prior-art-and-governance.md) |

Method: six parallel research passes over primary sources (official docs, specs, package source via `npm pack`, issue trackers, papers). Several claims were checked by small experiments (pixelmatch thresholds, Playwright determinism, Babel AST shapes, Ollama structured output). The lead re-verified the facts the architecture depends on: npm metadata for TypeScript 7, typescript-eslint peer ranges, pnpm settings and the Anthropic SDK typings.

## 1. The problem space, in one table

| Need | Existing options | What they do well | Gap for this project |
|---|---|---|---|
| Token / hard-coded value linting | Atlassian `ensure-design-token-usage`, SLDS Linter, Primer stylelint config, Shopify `stylelint-polaris`, `@shadcn/lint` (Tailwind v4, Sept 2026) | Mature rule logic (nearest token, ±1px spacing match, role-checked tokens) | Each is tied to one design system or to Tailwind, with lint-style output; none has a policy model with categories, enforcement or exceptions as data |
| Component usage enforcement | ESLint `react/forbid-elements`, `no-restricted-imports`, eslint-plugin-boundaries, dependency-cruiser | Import and element bans | No prop contracts tied to a component registry; no "re-implemented component" detection |
| Visual regression | Playwright `toHaveScreenshot`, Chromatic, Percy, Applitools, Argos, BackstopJS, reg-suit (Lost Pixel archived 2026-04) | Pixel and perceptual diffs, review workflows | A diff says "changed", not "violates the design"; hosted review services; baseline management is the hard part |
| AI code review | Copilot review, CodeRabbit, qodo pr-agent, claude-code-security-review | Broad natural-language review | Low published precision (SWR-Bench best F1 18.7%); references are not verified; some fail open; some read instructions from the PR head |
| Agent design guidance | Claude Agent Skills, AGENTS.md, llms.txt, Storybook MCP, Figma MCP / Code Connect, shadcn registry, v0 design systems | Context at generation time | Guidance only: nothing independently checks that the result followed it |
| Post-hoc AI-UI verifiers | Buoy, Deslint, DesignDiff, onsystem (all small, 2026) | Drift checks for agent output | Narrow, early-stage; no evidence model, provenance or trust boundary |

## 2. Decisions the research forced

1. **Parser: Babel 8, not the TypeScript compiler API.** `typescript@7.0.2` (the Go port) exports only a version stub plus `./unstable/*`. Its API spawns the Go binary and builds ASTs from project snapshots. typescript-eslint still requires `typescript <6.1`. Babel 8 is pure JS and gives locations on every node. See [ADR 0003](../decisions/0003-parsers-and-own-engine.md).
2. **Our own engine, not ESLint or Stylelint plugins.**
   - ESLint drops rule `data` from its output, so structured evidence has to be smuggled through message strings.
   - Blanket `eslint-disable` silences custom rules, and switching that off (`noInlineConfig`) warns on every directive.
   - Bulk suppressions are counts, so they cannot drive "new findings only".
   - Stylelint 17 pulls 116 packages, including a `braces` advisory. Its `color-no-hex` flags the token definitions themselves.
   - So we borrow their algorithms and keep the dependencies. Editor integration is a later adapter.
3. **Token source: built CSS custom properties.**
   - DTCG 2025.10 is now a stable Community Group report, but tool support is partial (Style Dictionary "not full support yet"), and DTCG does not define the CSS variable names that code actually references.
   - CSS custom properties work with every pipeline, including Tailwind v4's `@theme`.
   - DTCG metadata (`$deprecated`, `$type`) is a later, optional input.
4. **The policy is the source of truth; the skill is prose.** SKILL.md, AGENTS.md and llms.txt carry prose that cannot be checked. Design systems that publish agent guidance pair it with validators: Atlassian's ESLint plugins, Primer's `lint_css` MCP tool, Shopify's validation tools. We do the same, and the demo skill tells agents to run `design-warden check` before finishing.
5. **Visual: diff means "changed, needs review", never "violation".**
   - A hard-coded `#2563eb` renders identically to the token, so screenshots cannot see token misuse.
   - At the default pixelmatch threshold (0.1), adjacent token shades (blue-600 to blue-700) produce **zero** changed pixels. We use 0.02 and remove noise by clustering instead.
   - The recipe that gave 5 of 5 byte-identical captures: fixed `Date`, seeded `Math.random`, animations and caret disabled, network blocked.
   - Comparing across environments (headless vs headed: 784 px) is refused.
6. **AI review stays advisory and is verified locally.**
   - Every finding must cite a file and line that were shown to the model, with a quote that matches the line.
   - Numbered lines plus quote checking fixed the line-citation errors seen in experiments: 15 of 15 wrong without numbering.
   - No injection defence holds against adaptive attacks (over 90% success). So the model gets no tools, no secrets, a policy loaded from the base branch, and output rendered as escaped text without links (the CamoLeak lesson).
7. **CI: exit codes plus zero-permission outputs first.**
   - Workflow-command annotations, the job summary and `$GITHUB_OUTPUT` need only `contents: read`.
   - Annotations are capped at 10 per level per step, so we rank and truncate them.
   - Jobs have no "neutral" state, so "review requested" is exit 0 plus warnings and an output flag; `--fail-on review` makes it a hard gate.
   - The Checks API needs a GitHub App. SARIF needs paid Code Security on private repos, so it is deferred.

## 3. What is genuinely different here

Each of these exists partly elsewhere. The combination is new as far as this research could find:

- **One versioned policy model** that separates *category* (mandatory, required pattern, preferred, advisory), *severity* (how bad), *enforcement* (block, review, report) and per-finding *confidence* (how sure). It has reviewed, expiring exceptions, executable examples (`design-warden policy test`), and inline suppressions that cannot silence mandatory rules. The last point matters because coding agents habitually add disable comments.
- **Pattern provenance:** each changed component is classified as *established*, *modified*, *novel* or *insufficient evidence* against reference patterns and existing components. A novel pattern requests review instead of failing. We found no tool that does this per pull request; onsystem flags "invented" components but does not classify them.
- **A stated trust model:**
  - Deterministic engines gate merges. Model findings are capped at review.
  - Model references are re-checked against the repository, and unverifiable ones are downgraded or rejected.
  - The policy can be loaded from the base branch, and edits to the policy (including weakened rules) are always reported.
- **Evidence-first findings and an inspector:** each finding links rule, rationale, guidance section, file and line, suggested fix and screenshots. The inspector shows which engine produced it and which engines were skipped or failed.

## 4. Where Design Warden should not compete

- **Accessibility:** use axe-core, Storybook a11y or Lighthouse CI. An optional axe pass over states we already render is a cheap later addition. axe's own "57%" coverage figure is vendor-weighted, and a 2017 GOV.UK test found 29% of barriers missed by every tool.
- **Import-boundary rules:** ESLint `no-restricted-imports` and the design system's package `exports` already cover them.
- **Tailwind class linting:** `@shadcn/lint` covers it. An adapter that imports its results would be the integration point.
- **Hosted visual review and baselines:** Chromatic, Percy and Argos. Our visual engine compares base and head in the same run and makes no claim about design correctness.

## 5. Unresolved questions that affect the design

These are tracked in [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md).

- How stable captures are on real applications; we tested toy pages and the demo only.
- Calibrating the pixel threshold, including for dark themes.
- How vLLM and LM Studio treat unsupported JSON Schema keywords under `strict`.
- Whether TypeScript 7.1's API would make a type-aware engine practical.
- How well Jaccard-over-tag-sets provenance generalises beyond the demo.
