# Getting started

## Prerequisites

- **Node.js 24.11 or newer.** Design Warden runs its TypeScript sources directly with Node's built-in type stripping. This setup was developed and tested on Node 24.21 (Windows 11).
- **git 2.40 or newer.** Needed for change sets and scenarios.
- **pnpm 12** via corepack (bundled with Node 24): `corepack enable`, or prefix commands with `corepack pnpm`.
- **Chromium for Playwright.** Needed for visual capture, and for `pnpm test`, which includes real-browser tests: `pnpm exec playwright install chromium` (Chromium plus its headless shell, about 700 MB on disk on Windows).

No model provider, API key or network service is needed for the core checks.

## Install

```bash
git clone <this repository> design-warden && cd design-warden
corepack enable            # or use "corepack pnpm" below
pnpm install
pnpm exec playwright install chromium
pnpm typecheck
pnpm test                  # unit, integration, scenarios, benchmark, real-browser visual tests
pnpm test:e2e              # browser tests of the demo app and the inspector
```

pnpm refuses package versions published less than a day ago (`minimumReleaseAge`) and dependency build scripts that are not approved (`strictDepBuilds`). See [troubleshooting.md](troubleshooting.md) if an install fails on either.

## Run the demo app

```bash
pnpm demo                  # Acme Console at http://localhost:5173
```

Routes: `/` (overview), `/orders` (table and filters; add `?state=loading`, `?state=empty` or `?state=error`), `/orders/new` (form validation), `/settings` (disabled states).

## Run the CLI

```bash
# Full scan of the clean demo: PASS, 3 suppressed legacy findings (a time-boxed policy exception).
# The exception expires on 2027-03-31; after that the scan fails on purpose (add --today 2026-10-10 to reproduce this).
pnpm design-warden check --policy apps/demo/design-warden.policy.json

# Validate the policy and run its executable rule examples
pnpm design-warden policy validate --policy apps/demo/design-warden.policy.json
pnpm design-warden policy test --policy apps/demo/design-warden.policy.json

# Machine-readable report
pnpm design-warden check --policy apps/demo/design-warden.policy.json --format json --report .design-warden/report.json
```

In your own repository, check a change against the base branch. The packages are not on npm yet, so run Design Warden from this checkout. The directory of the policy file is the project, and git runs there:

```bash
# From the Design Warden checkout:
pnpm design-warden check --policy ../your-app/design-warden.policy.json --base origin/main
# Or from your repository's root, as CI does (report paths are then relative to it):
node ../design-warden/packages/cli/src/bin.ts check --policy design-warden.policy.json --base origin/main
```

Without git history (an archive, a CI system that copies files), compare with an older copy of the project instead: `--base-dir path/to/previous-copy`. The policy then comes from the project itself, the head copy: there is no `--policy-ref` for directories, so a change to the policy is reported (`policy/changed`, even if `project.exclude` lists the policy file) but also takes effect. Where a change must not weaken its own rules, use git and `--policy-ref`.

Exit codes: `0` pass or review requested, `1` blocking finding (or review with `--fail-on review`), `2` usage, policy or setup error (for example Chromium missing), `3` an engine failed closed.

## Run the seeded scenarios

```bash
pnpm scenario list
pnpm scenario run hardcoded-color          # terminal report + expectation check
pnpm scenario run all                      # all 11, each compared with its expected outcome
pnpm scenario run token-change --visual    # also builds base and head and compares screenshots (~35 s, ~22 s once the base is cached)
pnpm scenario run agent-evasion --semantic replay   # adds a recorded model review, verified locally
```

Each run copies the clean demo into `.design-warden/runs/<id>/<run>/workspace`, commits it as `main`, applies the scenario, and runs `design-warden check --base main`, the same code path as CI. `apps/demo` is not modified.

To see a scenario in the running demo app:

```bash
pnpm scenario apply new-pattern   # copies the change into apps/demo (backed up)
pnpm demo                         # look at the Overview page
pnpm design-warden check --policy apps/demo/design-warden.policy.json --base HEAD   # just the applied change
pnpm scenario reset               # restores apps/demo byte for byte
```

## Open the inspector

```bash
pnpm inspector             # builds the UI, serves http://127.0.0.1:4400
```

Pick a scenario, choose options, and press **Run**. Progress comes from the real engine. The report view shows the outcome, engine states, findings with evidence, guidance, provenance, visual diffs and the semantic review's accepted and rejected items. **Open a report file** loads any JSON report written by `design-warden check --report`.

## Try the CI example locally

The workflow in [`examples/github-actions/design-warden.yml`](../examples/github-actions/design-warden.yml) runs these commands. You can reproduce its outputs locally:

```bash
mkdir -p .design-warden   # git-ignored
GITHUB_STEP_SUMMARY=.design-warden/summary.md GITHUB_OUTPUT=.design-warden/out.txt \
  pnpm design-warden check --policy apps/demo/design-warden.policy.json --format github
```

In PowerShell:

```powershell
New-Item -ItemType Directory -Force .design-warden | Out-Null
$env:GITHUB_STEP_SUMMARY = '.design-warden/summary.md'; $env:GITHUB_OUTPUT = '.design-warden/out.txt'
pnpm design-warden check --policy apps/demo/design-warden.policy.json --format github
```

See [ci-integration.md](ci-integration.md) for permissions, the trust model and adapting it.

## Next steps

- Write a policy for your project: [policy-authoring.md](policy-authoring.md), starting from [`examples/policy`](../examples/policy).
- What each rule detects: [rules.md](rules.md).
- What the numbers mean: [evaluation.md](evaluation.md).
