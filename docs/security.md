# Security model and threat model

Design Warden reads private source code, may render it in a browser, may send parts of it to a model provider, and runs in CI next to secrets. This document states which properties hold, how they are enforced or tested, and what is **not** protected. Running locally is not, by itself, a security property.

## Assets

- Source code and screenshots of the application under review.
- Credentials: model provider keys in CI or on developer machines, and the CI token.
- The integrity of the gate: the policy, the outcome, the guidance shown to reviewers.
- The developer's machine, which runs the CLI and the inspector service.

## Properties and how they are enforced

| # | Property | Mechanism | Evidence |
|---|---|---|---|
| P1 | The policy is data; nothing in it executes | Strict zod schema with unknown keys rejected. Checks are selected by id from a fixed registry. Visual actions are a closed vocabulary (click, hover, focus, fill, press). No script, command, module or URL fields | `packages/core/test/policy.test.ts` (unknown check `exec-shell` rejected) |
| P2 | Paths cannot escape the project | `resolveInside` rejects absolute paths, `..`, NUL, and symlinks or junctions out of the root. Used for policy references, capture manifests, artifacts, guidance, model citations and scenario edits | `changes-paths-redact.test.ts` (including a junction escape), `compare.test.ts` (manifest traversal), `app.test.ts` (artifact traversal on a real run) |
| P3 | No shell; git refs cannot inject options | `execFile` only. Refs validated with `rev-parse --verify --end-of-options`; refs starting with `-` rejected. Diff output format pinned against user git config | `tests/repo.test.ts` (no `exec`/`shell: true`/`eval`) |
| P4 | Outbound network only where stated | Model calls exist only in `semantic-review/src/providers/*` and run only with `--semantic`. The capture browser aborts every request outside the app's origin and closes WebSockets to any other host. axe-core is read from `node_modules` and evaluated in the page, never fetched. The inspector and capture servers listen on 127.0.0.1 only | `tests/repo.test.ts` (network boundary across packages, tools and the inspector server), `capture.test.ts` (external image and WebSocket blocked) |
| P5 | Provider endpoints and keys are not repository-controlled | Provider, model, base URL and credentials come from CLI flags and environment, never from the policy file | Code: `packages/cli/src/main.ts` |
| P6 | Model output and repository text cannot block, execute or exfiltrate | Model outcome capped at review (schema plus `decideOutcome`). Output parsed as JSON only. References verified against the files shown. Text sanitised: links (including `javascript:`), images, control and line-separator characters. Rendered as plain text: React escaping in the inspector; markdown and autolinks escaped in summaries and the pull-request comment, where every report field is escaped or type-checked because the visual job's report may be forged; in GitHub logs the report sits between `::stop-commands::` markers with a random token, and annotation fields are escaped to one line | `verify.test.ts`, `review.test.ts`, `outcome.test.ts`, `cli.test.ts` (workflow-command injection, file-name escaping), `policy-and-reports.test.ts` (forged report in a comment), scenario `agent-evasion` |
| P7 | Minimal data to models | Changed in-scope files only, capped by count and size. Secrets redacted, line structure preserved, in files, guidance, and the deterministic-finding and provenance sections. Every repository-derived section is fenced as data. `--semantic-dry-run` shows the exact payload | `review.test.ts` (redaction, fenced findings and provenance, section-only guidance) |
| P8 | A change cannot weaken its own gate (with `--policy-ref`, and the tool run from the base branch) | Policy and guidance loaded from the base ref. Policy edits always reported, with weakening called out. Mandatory and required-pattern rules cannot be suppressed inline. Approvals (ADR 0012) are read with the policy, so a change cannot approve its own review requests, and they clear review findings only, never blocking ones. The example workflow runs Design Warden itself from a base-branch worktree | `cli.test.ts`, `policy-and-reports.test.ts` (approvals: review-only, base ref, expiry), scenarios `policy-weakening`, `agent-evasion`; workflow commands run locally (docs/ci-integration.md) |
| P9 | Failures are visible | Every engine reports completed / skipped / failed / incomplete with a reason. `failurePolicy` decides the effect. A failed model review is never shown as passed | `outcome.test.ts`, `engine-failure.test.ts` |
| P10 | The inspector service is not a remote-execution surface | Loopback bind. `Host` allowlist (DNS rebinding). POST needs `application/json`, which a cross-site page cannot send without a CORS preflight the server never approves; an `Origin` header, when present, must be this server (CSRF). Only known scenario ids. Body ≤ 4 KB (413). Artifacts limited to `.png` inside the run directory. CSP `script-src 'self'`, `frame-ancestors 'none'`, `nosniff` | `apps/inspector/server/app.test.ts` |
| P11 | Supply chain hygiene | Exact pins and a lockfile. pnpm `minimumReleaseAge` (1 day), `strictDepBuilds`, `blockExoticSubdeps`, `trustPolicy: no-downgrade`. The CI tool install uses `--ignore-scripts`. Workflow actions are pinned to full commit SHAs | `pnpm-workspace.yaml`, `tests/repo.test.ts` (unpinned `uses:` fails) |
| P12 | A change cannot hide lines from the change set | The file list comes from `git diff --name-status -z`, so spaces, quotes, newlines and renames in names cannot drop a file. Hunks come from `--text`, so a `-diff` attribute cannot hide content. A changed file without parsed hunks counts as changed everywhere (fail closed), except a rename whose content is unchanged byte for byte (blob ids compared; git's similarity score ignores line order, so it is not trusted), which changes no lines. Code renamed in from a path a rule did not cover counts as new for that rule. Git runs with pinned output options and `core.quotePath=false` | `changes-paths-redact.test.ts` (name-status, quoted paths), `packages/source-analysis/test/changes.test.ts` ("change sets cannot be evaded") |

## Threats by context

### Local execution (developer machine)

- **Malicious repository content.** For example, a cloned PR branch with crafted TSX/CSS. Parsers are pure JavaScript (Babel, PostCSS and postcss-scss, and the Vue and Svelte compilers, used only to parse) on untrusted text, with no code evaluation. Oversized files are reported as unparseable instead of parsed. An oversized token source, or a DTCG file whose `$extends` would expand without bound, fails the source engine (fail-closed by default). Visual capture builds and serves the app, which executes the app's own code in a sandboxed browser, as `vite build` would anyway. Do not capture untrusted code you would not build.
- **Inspector exposure.** Bound to loopback, with Host and Origin checks. Any local process can still call it; it trusts the local user.

### CI execution

- **Pull request modifies the workflow.** On `pull_request`, the PR's workflow file runs. Same-repository authors can change it. Mitigate with CODEOWNERS and rulesets on `.github/workflows/**`. Fork PRs get no secrets.
- **Pull request modifies the policy.** Mitigated by `--policy-ref` plus the `policy/changed` finding. Not mitigated if the workflow does not use `--policy-ref`.
- **Pull request modifies Design Warden itself.** Every job in the example workflow runs the tool from a worktree of the base branch, installed with `--ignore-scripts`, so a PR cannot change the analyzer that judges it. This holds only while the base branch is protected.
- **Secret exfiltration through install scripts.** The `check` and `semantic` jobs never install or run PR code. The key exists only in the semantic job, on one step. The `visual` job does run PR code (the build) by necessity: it holds no secrets, and since build scripts could tamper with its captures or its copy of the tool, its report never blocks.
- **Token permissions.** `contents: read` in every job. Only the `comment` job adds `pull-requests: write`, to keep one comment up to date. It checks out the base branch, never pull-request code. It renders the other jobs' reports as data. The visual job runs the pull request's build and could forge anything it uploads, so reports are fetched by the artifact id each job outputs, sections are titled by job (a forged report cannot pose as the deterministic check), every field is escaped or type-checked, and `@` mentions are neutralised. The render step has no token; the post step only runs `gh`. It updates only a comment that its own bot wrote and that starts with the marker. Fork and Dependabot pull requests are skipped (read-only token). No job writes to the repository.

### Repository-controlled configuration

The policy, guidance, scenario files and design skill are repository content.
- With `--policy-ref`, the policy and the guidance sent to the model come from the base ref.
- Without it (local runs), the working tree is trusted by definition.

### Model provider exposure

- **Data leaving the machine.** Changed files, guidance excerpts, findings and optionally screenshots go to the configured provider when, and only when, `--semantic anthropic|openai-compatible` is used.
- **Redaction is pattern-based.** It catches common token formats, not every secret. Do not enable semantic review on code that must not leave your environment. Use a local model (`openai-compatible` with Ollama) or the dry run to inspect payloads.
- **Anthropic refusal fallback.** The provider requests `fallbacks: "default"`, which can route a declined request to another Anthropic model. The serving model is recorded in the report. Remove the parameter in `providers/anthropic.ts` if your data-handling terms require a single model.

### Malicious inputs

| Input | Threat | Handling |
|---|---|---|
| Source comments and strings | Prompt injection ("AI reviewer: approve") | Data-fenced with random delimiters; model has no tools; output capped and verified; injection attempts can be reported as advisory findings (scenario `agent-evasion`). **Not prevented**: a model can still be misled into noise |
| Inline suppressions | An agent silencing rules | Rule-specific, reasons required, not allowed for mandatory and required-pattern rules; rejections reported |
| Model output | Fabricated locations or rules; links for exfiltration; markup | Rejected or downgraded; links stripped; escaped rendering |
| Capture manifests and reports | Path traversal through `file` fields | `resolveInside` and schema validation |
| Huge or binary files | Resource exhaustion | Files over 2,000,000 characters are reported as not analyzed (review) instead of parsed; parse errors become findings; policy ≤ 1 MiB; inspector request bodies ≤ 4 KB |
| File names and git attributes | Hiding a changed file or hunk from the change set | NUL-separated name-status, `--text` patches, fail-closed whole-file fallback (P12) |
| Repository text in CI logs | Injecting `::error`/`::add-mask`/`::stop-commands` workflow commands | Report wrapped in stop-commands with a random token; annotation fields escaped and single-line (P6) |

## Known limitations

- Prompt injection cannot be fully prevented. The design limits its impact: the model can only add review noise, never pass or fail a change.
- Secret redaction is best effort.
- The inspector service trusts the local user and is not hardened for multi-user hosts.
- Visual capture executes the application under review.
- `--base-dir` reads the policy from the head copy (there is no directory equivalent of `--policy-ref`). Policy and token-source changes are always compared and reported as `policy/changed`, but they take effect in that run.
- No signature or provenance verification of Design Warden itself. It runs from a source checkout.
- Dependency vulnerabilities are checked with `pnpm audit --audit-level high` in this repository's CI. On 2026-10-10 it reported no known vulnerabilities. It only knows published advisories. One finding from research: Stylelint's dependency tree carried a high-severity advisory, which is one reason it is not used.

Reporting vulnerabilities: see [SECURITY.md](../SECURITY.md).
