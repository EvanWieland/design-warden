# ADR 0012: Approvals clear accepted review requests, from the trusted policy only

Status: Accepted, 2026-10-10

## Context

A review request (a novel pattern, a visual change, insufficient evidence, an AI finding) is raised again on every run until the code changes. When an owner has looked at it and accepted it, repeating it costs attention, and in full scans or code-scanning dashboards it never goes away. Open question #8 asked whether accepted review requests should be remembered, for example as approved fingerprints in a file.

Remembering an acceptance is a trust boundary. Whoever can write an approval can silence a request for human review. If a change can approve itself, the review step means nothing; with `--fail-on review`, a change could clear its own gate.

## Decision

- **Where:** approvals are a section of the policy file, `approvals[]`, next to `exceptions[]`. They are data, validated by the policy schema, and visible in the same review.
- **What one names:** the finding's fingerprint (its `id` in the JSON report, `partialFingerprints` in SARIF), the rule, the file (omitted for findings without a location, such as visual changes), a reason (at least 10 characters), who approved it, and an expiry date. Expiry is required, so acceptances are re-examined.
- **What it can do:** clear one finding whose outcome would be `review`. It never touches a `fail`: a blocking violation still needs a policy exception or a fix. A cleared finding stays in the report as suppressed (`by: approval`, with the reason and approver) and moves to `info`, like an exception.
- **Binding:** the fingerprint hashes the rule, the file and the evidence text: the flagged code line, plus the whole span for a multi-line finding such as a component (added after the 2026-10-10 review found that only the first line counted), or the message for findings without code. Code evidence counts only when it is in the finding's own file, so a visual finding's style hints, which point elsewhere and are shared between screens, do not bind it (2026-10-11). Whitespace is normalised. Any other edit to the flagged code, or a different visual diff, changes the fingerprint, so the approval stops matching and the request returns.
- **Who may write them, and where they are read:** approvals are read from wherever the policy is read. In CI that is the base branch (`--policy-ref`), so a change cannot approve its own review requests: approvals it adds take effect only after they are merged, under the owner review that protects the policy (CODEOWNERS, rulesets). Until then they show up in `policy/changed`, one note per added, changed or removed approval.
- **Per-pull-request memory** (not repeating a request on every push of the same pull request) is left to the platform: dismissing a code-scanning alert persists across pushes because SARIF results carry the fingerprint, and a label-gated re-run handles `--fail-on review`. Both require repository permissions that Design Warden does not manage.

## Consequences

- Full scans and code-scanning dashboards stop repeating accepted review requests. An accepted request returns when the code changes or the approval expires.
- A pull request's own approvals have no effect on its own run, which is deliberate. Owners approve in the base branch, or dismiss the code-scanning alert.
- Locally, without `--policy-ref`, approvals come from the working tree, like the rest of the policy.

## Alternatives considered

- **A separate approvals file read from the pull request's head:** lets a change approve itself. CODEOWNERS would still require an owner to approve the merge, but the check would already pass with the self-approval.
- **Approvals through the platform API (pull-request reviews, labels):** platform-specific, needs a token in the check job, and is better served by code-scanning dismissals.
- **Approving blocking findings:** rejected. That is what time-boxed, path-scoped policy exceptions are for.
