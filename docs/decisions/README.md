# Architecture decision records

Short records of consequential choices: context, decision, consequences, alternatives. A superseded ADR is kept and marked, not deleted.

| ADR | Decision |
|---|---|
| [0001](0001-trust-model.md) | Deterministic engines gate merges; model findings can only request review |
| [0002](0002-typescript-monorepo-without-build.md) | TypeScript pnpm workspace, run from source on Node 24, type-checked by tsc 7 |
| [0003](0003-parsers-and-own-engine.md) | Babel 8 + PostCSS in our own engine instead of ESLint/Stylelint plugins |
| [0004](0004-policy-format.md) | Versioned JSON policy, data only, validated with zod; category / severity / enforcement |
| [0005](0005-findings-and-outcomes.md) | One function maps verdict x enforcement to fail/review/info; documented exit codes |
| [0006](0006-change-scoping.md) | Git merge-base change sets; changed-lines scope; policy from the base ref |
| [0007](0007-visual-analysis.md) | Playwright library capture with a deterministic preset; pixelmatch 8 + clustering; same-run base/head |
| [0008](0008-semantic-review.md) | Provider-agnostic semantic review with structured output and local verification |
| [0009](0009-pattern-provenance.md) | Provenance by structural fingerprints, no embeddings |
| [0010](0010-inspector-and-harness.md) | Inspector = static UI + localhost-only service with fixed endpoints; scenario harness |
| [0011](0011-ci-integration.md) | Exit codes + workflow-command annotations + job summary; no Checks API; SARIF and GitLab Code Quality later (added: `--format sarif`, `--format gitlab`) |
| [0012](0012-approvals.md) | Approvals clear accepted review requests, review-only, read from the trusted policy source |
