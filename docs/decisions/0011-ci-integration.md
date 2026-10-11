# ADR 0011: CI integration through exit codes, annotations and the job summary

Status: Accepted, 2026-10-10

## Context

See [ci-integration.md](../research/ci-integration.md):

- Workflow-command annotations, job summaries and `$GITHUB_OUTPUT` need no permissions beyond `contents: read`.
- GitHub shows at most 10 annotations per level per step.
- A job can only succeed or fail; required checks treat "neutral" as passing.
- Only GitHub Apps can create check runs properly.
- SARIF upload needs `security-events: write` and, on private repositories, the paid Code Security product.

## Decision

- **Exit codes** (ADR 0005) are the gate.
- **`--format github`** emits:
  - annotations ranked fail → review → info, capped at 10 per level, de-duplicated by fingerprint, with paths validated against the workspace and line numbers checked against the file (an invalid location is omitted rather than guessed);
  - a markdown job summary, with link and image syntax escaped because findings can contain model or repository text;
  - `outcome`, `exit-code`, `blocking` and `review` in `$GITHUB_OUTPUT`.
- "Review requested" exits 0 by default and shows as warnings plus the summary. Hard gating is opt-in with `--fail-on review`. Human approval should come from CODEOWNERS on design-system paths and the policy.
- The example workflow:
  - uses `pull_request` with `permissions: contents: read` and `fetch-depth: 0`;
  - loads the policy from the base branch (`--policy-ref`);
  - runs visual capture in the Playwright container pinned to the npm version (`v1.64.0-noble`);
  - runs the optional semantic review in a separate job that holds the only secret and is skipped when the key is missing (forks, Dependabot);
  - runs Design Warden itself from a `git worktree` of the base branch, installed with `--ignore-scripts`, so a pull request cannot change the tool that judges it (added after the security review);
  - gives the review-only jobs `--only visual` / `--only semantic`, so they neither repeat the blocking job's source findings nor fail when it fails.
- The human-readable report in the log is wrapped in `::stop-commands::<random token>`, so repository or model text cannot issue workflow commands.
- JSON reports are uploaded as artifacts for the inspector.

## Consequences

- No GitHub App is needed, and the annotations and summary need no licence.
- The pull-request comment (added 2026-10-11) is the only write. A `comment` job with `pull-requests: write` checks out the base branch. It downloads the other jobs' reports by the artifact id each job outputs, not by name: the visual job runs pull-request code and could upload under any name. It titles each section by the job that produced it, renders without the token in the environment, and updates only its own marked comment. Fork and Dependabot pull requests are skipped.
- SARIF (`--format sarif`) and GitLab Code Quality (`--format gitlab`) output were added later ([ci-integration.md](../ci-integration.md)). Uploading SARIF needs `security-events: write`, and on private repositories GitHub Code Security.
