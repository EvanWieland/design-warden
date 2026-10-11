# Contributing

Thanks for helping. Design Warden is small on purpose: favour evidence over intuition, deterministic checks over AI, and explicit uncertainty over false confidence.

## Setup

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
pnpm typecheck && pnpm test
```

Node 24.11+ is required: packages run from TypeScript source through Node's type stripping (ADR 0002).

## Ground rules

- **Small modules, explicit types, straightforward control flow.** Use the Node standard library before adding a dependency. Pin dependencies exactly (`pnpm add --save-exact`).
- **Erasable TypeScript only:** no enums, namespaces or parameter properties. Use `.ts` import extensions and `import type`.
- **Engines report, core decides.** Checks return `FindingDraft`s; only `decideOutcome` maps them to outcomes.
- **Never weaken the trust model** ([docs/security.md](docs/security.md)) without an ADR: the policy stays data, paths go through `resolveInside`, model output stays capped and verified, and no network access is added outside `semantic-review`. `tests/repo.test.ts` enforces parts of this.
- **Ground truth is hand-written.** Scenario expectations and benchmark labels describe intended behaviour. Do not edit them to match new output; edit them when the intended behaviour changes, and say why in the PR.
- **Docs must match the code.** If you change behaviour, update `docs/rules.md`, `docs/evaluation.md` (numbers from a real run) and the relevant ADR.

## Common tasks

| Task | Where to start |
|---|---|
| New or changed check | `.claude/skills/add-design-rule/SKILL.md` |
| Policy changes | `.claude/skills/author-policy/SKILL.md`; then `pnpm schema` if the schema changed |
| A wrong finding | `.claude/skills/evaluate-findings/SKILL.md`: add a labelled benchmark case or a scenario |
| New semantic provider | `packages/semantic-review/src/providers/` plus the CLI switch; test against a local mock server |
| New report format | A `Report → string` function next to `packages/cli/src/reporters/markdown.ts` |

## Before opening a pull request

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm check:demo
pnpm eval
```

Describe what you verified and how. A design decision with lasting consequences gets a short ADR in `docs/decisions/`.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do not file public issues for vulnerabilities.
