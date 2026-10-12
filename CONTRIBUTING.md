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

## Releasing

The five npm packages (`design-warden` and `@design-warden/{core,source-analysis,visual-analysis,semantic-review}`) are released together, at one version, by `.github/workflows/release.yml`. npm trusts that workflow (trusted publishing): no npm token is stored, and no 2FA approval is needed at release time.

1. Set the new version in the five `packages/*/package.json`. Move the CHANGELOG's Unreleased entries under the new version and date. Update the pinned `design-warden@x.y.z` in the docs and workflows; for a new minor version, also update the schema link (`@design-warden/core@x.y`) in `examples/policy` and `packages/cli/starter`. `tests/repo.test.ts` fails until they match.
2. Commit, push, and wait for CI.
3. Tag the commit and push the tag: `git tag -a vX.Y.Z -m "Design Warden X.Y.Z" && git push origin vX.Y.Z`. The Release workflow checks that the tag matches the versions, runs the type check and the full test suite, packs, and publishes the libraries before `design-warden`. A re-run skips the packages that are already published.
4. Check `npm view design-warden version` and `npx --yes design-warden@X.Y.Z --version`.

**Trusted publishing**, set up once per package (done for all five on 2026-10-11; each command asks for a 2FA approval):

```bash
npm trust github <package> --file release.yml --repo EvanWieland/design-warden --allow-publish --yes
npm trust list <package>
```

To check the setup without publishing, run the workflow by hand (Actions > Release > Run workflow). Its `trust` job exchanges the workflow's OIDC token for each package, as `npm publish` would, and fails for any package that does not trust it. All five packages require two-factor authentication and disallow tokens (npm package settings > Publishing access, set on 2026-10-12): only this workflow, or a maintainer approving with 2FA, can publish. Trusted publishing still works under that setting (checked with the trust job). The repository is private, so npm attaches no provenance attestations; they would appear automatically if it became public.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do not file public issues for vulnerabilities.
