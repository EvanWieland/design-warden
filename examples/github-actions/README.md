# GitHub Actions example

[`design-warden.yml`](design-warden.yml) runs Design Warden on pull requests. This repository runs the same file as `.github/workflows/design-warden.yml`; `tests/repo.test.ts` keeps the two identical.

Every job runs a trusted copy of Design Warden: a git worktree of the base branch, outside the checkout, installed with `--ignore-scripts`.

- **check** (blocking): deterministic check, with the policy loaded from the base branch. `contents: read`, no secrets.
- **visual** (review only): builds and captures the base and head revisions in the pinned Playwright container, then compares them with `--only visual`. It executes pull-request code, so it has no secrets and never blocks.
- **semantic** (review only, optional): reviews the pull request's files with `--only semantic`, with the API key visible to one step only. Runs after `check` passes. Skipped without the secret, for example on forks and Dependabot.

To adapt it, change `PROJECT_DIR`, `BUILD`, `DIST` and `BASE` under `env`. The actions are already pinned to commit SHAs; keep them pinned when you update them. Protect the workflow, the policy, the design-system paths and the tool's source with CODEOWNERS and a ruleset that requires owner review. A starting point:

```text
# .github/CODEOWNERS
/.github/workflows/            @your-org/platform
# Design Warden itself, when vendored as in this repository
/packages/                     @your-org/platform
**/design-warden.policy.json   @your-org/design-system
/src/design-system/            @your-org/design-system
```

Background, trade-offs and what was verified: [docs/ci-integration.md](../../docs/ci-integration.md).
