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
- `--base-dir <dir>` (added later) builds the same change set from an older copy of the project, without git history: both trees are listed with the policy's project globs, and files that differ are diffed with `git diff --no-index`. A deleted and an added file with identical content, or with at least 50% of their lines in common and the same extension, pair as a rename (added 2026-10-11), and `base.sha` is empty.
- Without `--base` or `--base-dir`, the whole project is scanned and every finding counts.
- `--policy-ref <ref>` loads the policy and the guidance files given to the model from that ref.
- If the change set touches the policy file, a built-in, always-on `policy/changed` finding (review) lists rule-level changes. Weakened enforcement and removed blocking rules are called out.

## Consequences

- Legacy violations appear as pre-existing (informational) and never block unrelated work.
- Renames (amended 2026-10-11): a renamed file keeps the lines its diff marks. Without hunks it changes no lines only if its content is identical byte for byte (the blob ids are compared). git's similarity score ignores line order, so a 100% score is not trusted. Findings in a file renamed from a path that a rule did not cover are new for that rule, so two pull requests cannot move unscanned code into scope as pre-existing.
- `--policy-ref` protects only if the workflow file itself is protected, by CODEOWNERS or rulesets, because on `pull_request` the PR controls the workflow. This is documented in SECURITY.md.

## Alternatives considered

Directory-to-directory comparison was not needed once the scenario harness used temporary git repositories. It was added later as `--base-dir` for checkouts without history (archives, other CI systems).
