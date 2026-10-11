# ADR 0006: Git change sets, changed-line scope, and a policy from the base ref

Status: Accepted, 2026-10-10

## Context

Blocking a pull request for violations it did not introduce makes a gate unadoptable in a legacy codebase. Running on the PR head also means the PR controls the policy that judges it ([ci-integration.md](../research/ci-integration.md)).

## Decision

- `--base <ref>` builds a change set:
  - the ref is resolved with `rev-parse --verify --end-of-options` (refs starting with `-` are rejected);
  - the diff runs from the merge base to the working tree;
  - untracked files are included, because agents create files without staging them.
- Git runs without a shell (`execFile`), with explicit `--src-prefix/--dst-prefix`, `--no-ext-diff`, `--no-textconv` and `core.quotePath=false`, so the user's git config cannot change the output.
- Default scope with a base is `changed-lines`. Pure deletions mark the lines on either side, so a deleted prop still lands inside the element's span. `changed-files` and `all` are available.
- Per-file checks run only on changed files. Project checks (provenance, shared-change impact) read base versions with `git show <merge-base>:./<path>`.
- `--base-dir <dir>` (added later) builds the same change set from an older copy of the project, without git history: both trees are listed with the policy's project globs, and files that differ are diffed with `git diff --no-index`. Renames appear as a deletion plus an addition, and `base.sha` is empty.
- Without `--base` or `--base-dir`, the whole project is scanned and every finding counts.
- `--policy-ref <ref>` loads the policy and the guidance files given to the model from that ref.
- If the change set touches the policy file, a built-in, always-on `policy/changed` finding (review) lists rule-level changes. Weakened enforcement and removed blocking rules are called out.

## Consequences

- Legacy violations appear as pre-existing (informational) and never block unrelated work.
- `--policy-ref` protects only if the workflow file itself is protected, by CODEOWNERS or rulesets, because on `pull_request` the PR controls the workflow. This is documented in SECURITY.md.

## Alternatives considered

Directory-to-directory comparison was not needed once the scenario harness used temporary git repositories. It was added later as `--base-dir` for checkouts without history (archives, other CI systems).
