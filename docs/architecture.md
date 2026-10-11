# Architecture

Design Warden turns a design policy and a code change into evidence-backed findings and one CI outcome. Every engine reports observations; one function in core decides what they mean for the merge.

```
            design-warden.policy.json ──► core: parse + validate (zod, data only)
                          │
 git base ref ──► core: change set (merge base → working tree, untracked)
 or base dir  ──►       (or base directory → project, via git diff --no-index)
                          │
        ┌─────────────────┼─────────────────────────┬──────────────────────────┐
        ▼                 ▼                         ▼                          ▼
  source-analysis    visual-analysis           semantic-review             policy check
  (Babel, PostCSS)   (Playwright capture,      (optional provider,         (policy/changed)
  checks, provenance  pixelmatch, regions)      verify every reference)
        │                 │                         │                          │
        └─────────────── FindingDraft[] ────────────┴──────────────────────────┘
                          │
              core: finalizeFindings  (rule metadata, exceptions, approvals, change scope, fingerprint)
                          │
              core: decideOutcome     (verdict × enforcement → fail / review / info; AI ≤ review)
                          │
              core: overallOutcome    (+ engine failures × failurePolicy) → exit code
                          │
         Report (JSON v1) ──► terminal · markdown · GitHub annotations/summary · SARIF · GitLab Code Quality · inspector UI
```

## Packages

| Package | Responsibility | Depends on | Notable |
|---|---|---|---|
| `packages/core` | Policy schema and loader, findings model, `decideOutcome` / `overallOutcome`, change sets (git ref or base directory), safe paths, secret redaction, report types | zod | No engine logic, no network |
| `packages/source-analysis` | Deterministic checks over TSX/TS/CSS/SCSS, Vue and Svelte (plus Tailwind classes and CSS-in-JS templates), token sets (CSS or DTCG), JSX resolution, provenance, shared-change impact, inline exceptions | core, @babel/parser, postcss, postcss-scss, postcss-value-parser, @vue/compiler-dom and svelte (both loaded lazily), zod | Checks return drafts only |
| `packages/visual-analysis` | `./capture`: Playwright capture (with optional axe-core) and a loopback static server. `.`: manifest reading, pixel comparison, region clustering, accessibility comparison | core, playwright, axe-core, pixelmatch, pngjs, zod | Playwright is loaded only through `./capture` |
| `packages/semantic-review` | Prompt building, provider contract, providers (Anthropic SDK, OpenAI-compatible, replay), response verification | core, @anthropic-ai/sdk, zod | The only code that calls model providers |
| `packages/cli` | `analyze()` orchestrator, reporters, `design-warden` command | all of the above | Programmatic API for the harness and inspector |
| `tools/harness` | Scenario runner (temporary git repos), apply/reset, benchmark, semantic evaluation | cli, core, engines | Development tooling, not shipped |
| `apps/demo` | The fixture app: tokens, 16 components, 4 pages, policy, design skill | react, vite | Must stay compliant (`pnpm check:demo`) |
| `apps/inspector` | `server/`: loopback service with fixed endpoints. `src/`: React UI | harness, cli, core | Shows real reports only |

Why separate packages: dependency and network isolation (ADR 0002). A team that only wants source checks never loads Playwright or a model SDK, and the network boundary is enforced by `tests/repo.test.ts`.

## Data model

**Policy (v1)**, from `packages/core/src/policy/schema.ts`; guide in [policy-authoring.md](policy-authoring.md):
- project scope, design-system paths and import sources, token sources and allowed prefixes;
- component registry (`replaces`, `aliases`, prop contracts), reference patterns, guidance index;
- rules (id, version, category, severity, enforcement, verify, scope, guidance, remediation, examples);
- exceptions, approvals, visual config, semantic-review limits, `failurePolicy`.

**FindingDraft → Finding** (`packages/core/src/findings.ts`):

| Field | Meaning |
|---|---|
| `ruleId`, `ruleVersion`, `title`, `category` | From the policy, or a built-in governance rule (`policy/changed`, `policy/exception-expired`, `policy/inline-exception-rejected`, `analysis/unparseable-file`, `semantic/advisory`) |
| `verdict` | `violation`, `probable-violation`, `insufficient-evidence`, `acceptable-deviation`, `notice` |
| `confidence` | `high` / `medium` / `low`. How sure the engine is; never used for blocking |
| `severity` / `enforcement` | How bad / what CI does (`block`, `review`, `report`), from the rule |
| `origin`, `engine` | `deterministic` / `heuristic` / `ai`; `source` / `visual` / `semantic` / `policy` |
| `location`, `evidence[]` | `file:line[:col]` (+ `endLine`); code snippets, token changes with usages, component usages, screenshots, notes |
| `suggestion`, `remediation`, `rationale`, `guidance[]` | What to do, why, where the guidance lives |
| `outcome`, `outcomeReason` | `fail` / `review` / `info`, with the reason |
| `suppressed`, `preexisting` | Exception, inline suppression or approval; outside the changed lines |
| `id` | Stable fingerprint (rule + file + evidence text, plus the whole span of a multi-line finding). It de-duplicates annotations, is the SARIF and GitLab fingerprint, and is what an approval names |

**Report (v1)** (`packages/core/src/report.ts`):
- policy identity (name, revision, sha256, source: working tree or `git:<ref>`), target (base ref and merge base, scope, changed files);
- outcome, reasons and exit code; summary counts; engine statuses (`completed` / `skipped` / `failed` / `incomplete`, with reasons and durations);
- findings, provenance records, visual diff summaries, and the semantic summary (provider, model, endpoint, data sent, accepted / downgraded / rejected).

## Outcome rules

`decideOutcome` (ADR 0005):

| Verdict | block | review | report |
|---|---|---|---|
| violation | **fail** | review | info |
| probable-violation | review | review | info |
| insufficient-evidence | review | review | info |
| acceptable-deviation / notice | info | info | info |

Suppressed and pre-existing findings → `info`. `origin: ai` → at most `review`. Overall: an engine failure in `fail-closed` mode → `error` (exit 3); otherwise any `fail` → exit 1; any `review` → exit 0 (or 1 with `--fail-on review`); otherwise `pass`.

## Failure behaviour

| Situation | Result |
|---|---|
| Invalid policy, bad flags, unknown base ref, Chromium missing | exit 2 with the reason; an invalid policy lists every schema issue |
| Source engine throws | engine `failed`; `failurePolicy.source` (default `fail-closed` → exit 3) |
| File cannot be parsed, or holds markup the adapters cannot read (`<template lang="pug">`, `<style lang="less">`, a block with `src`) | `analysis/unparseable-file` finding (review); other files still checked |
| Visual or accessibility comparison fails (missing manifest, fingerprint mismatch) | engine `failed`; default `review` |
| Accessibility results from another axe-core version or other tags, or captures made without axe | one `insufficient-evidence` finding instead of a comparison |
| A state cannot be captured | `insufficient-evidence` finding for that state |
| Model unavailable, 429, timeout, refusal, truncated or malformed output | semantic `failed` with reason; deterministic findings kept; default `review` |
| Some changed files over `maxFiles` | semantic `incomplete` with reason |
| Engine not requested or not configured | `skipped` with reason (no effect on outcome) |

## Provider interface

```ts
interface SemanticProvider {
  name: string; model?: string; endpoint?: string; supportsImages: boolean;
  review(req: ReviewRequest, signal: AbortSignal): Promise<{ text: string; model?: string; truncated: boolean; usage?: {...} }>;
}
```

Providers transport a prepared request; they never interpret output. Adding one means writing about 60 lines in `packages/semantic-review/src/providers/` and adding a case to `semanticProvider()` in `packages/cli/src/main.ts`. Details: [semantic-review.md](semantic-review.md).

## Extension points

- **New check:** `defineCheck` in `source-analysis/src/checks/` (skill `add-design-rule`).
- **New file type or framework:** extend `parse.ts` (`fileKind`, `parseFile`). Checks consume `StyleValue`s and `JsxUsage`s. For a template language, write an adapter that returns `TemplateParts` (`templates.ts`): elements with Babel-like attribute values (string literals, or expressions parsed at their file position), style blocks, and the script text with the rest of the file blanked. `vue.ts` and `svelte.ts` are the examples.
- **New token source:** produce `TokenDef[]`, as `parseTokenDefs` (CSS) and `parseDtcgTokens` (DTCG JSON) do in `tokens.ts`.
- **New report format:** a function `Report → string` beside `reporters/markdown.ts`, as `reporters/sarif.ts` and `reporters/gitlab.ts` are.
- **New provider:** see above.

## Security boundaries

See [security.md](security.md):
- the policy is data;
- paths stay inside the project root;
- only `semantic-review` (opt-in) and the capture browser (same-origin only) make outbound requests; the capture server and the inspector listen on loopback only (`tests/repo.test.ts` keeps this list true);
- model output is verified, sanitised and capped at review;
- the inspector listens on loopback with Host and Origin checks.
