# Plan and progress

## Understanding of the brief

**Stated by the requester:**
- Build Design Warden, an open-source, production-minded tool that independently verifies UI changes against design-system policy. The design skill instructs agents; Design Warden verifies the result.
- It must distinguish hard violations, review requests and uncertainty.
- It must work without any model provider and stay safe on private code.
- It will later be copied and adapted for an enterprise codebase, so clarity and extension points matter more than breadth.

**Assumed** (not stated, chosen as defaults):
- GitHub is the first CI target.
- Plain CSS plus React/TSX is the first frontend stack; Tailwind, CSS-in-JS and SCSS come later.
- The tool runs from a checkout of this repository; npm publishing comes later.
- English-only UI.

**Success** = the brief's "Definition of done" (13 items), each mapped to a command or document in [the table below the stages](#definition-of-done).

## Smallest end-to-end slice

The slice that proves the core value:

1. A policy file is validated.
2. `design-warden check --base main` analyses a change.
3. A deterministic rule produces a finding with rule, rationale, location and suggestion.
4. The outcome maps to an exit code.
5. A JSON report renders in the inspector.

Everything else (visual, provenance, semantic review, scenarios) layers onto the same findings model.

## Stages and acceptance criteria

| # | Stage | Acceptance criteria | Status |
|---|---|---|---|
| 0 | Research and decisions | 6 topic notes + landscape; 11 ADRs (12 since B12); this plan; open questions | Done |
| 1 | Core model | Policy schema with clear errors; findings and outcome mapping; git change sets; path safety; redaction; unit-tested | Done |
| 2 | Deterministic source engine | 8 checks (colors, spacing, tokens, raw elements, prop contracts, duplicates, provenance, shared-change impact; 9 since B1 added `no-important`); inline and policy exceptions; parse errors surfaced; fixture tests | Done |
| 3 | CLI and reporters | `check`, `capture`, `policy validate/test/schema`, `checks`; terminal, JSON, markdown and GitHub outputs; documented exit codes; tests for malformed config and engine failure | Done |
| 4 | Visual engine | Deterministic capture (byte-identical across runs), clustering, fingerprint guard, artifacts; tests with real Chromium | Done |
| 5 | Semantic review | Provider interface; Anthropic SDK, OpenAI-compatible and replay providers; verification fails closed; dry run; tests with mocked endpoints | Done |
| 6 | Demo app | Polished React app (dashboard, table and filters, form, settings, loading/empty/error/disabled states), token system, components, reference patterns, design skill. A full scan passes cleanly. | Done |
| 7 | Scenarios and harness | 11 seeded scenarios with expected outcomes; reproducible `run` in temporary git repos; `apply`/`reset`; integration test asserting every expectation | Done |
| 8 | Inspector | Localhost service with fixed endpoints and live progress; UI showing status, counts, findings, evidence, guidance, screenshots, engine states, AI vs deterministic; Playwright e2e tests | Done |
| 9 | Evaluation | Benchmark corpus; per-rule precision/recall, location accuracy, insufficient-evidence rate, latency; opt-in live-model evaluation | Done (live model not run) |
| 10 | CI, docs, Claude Code guidance | Example workflow; repo CI; README, getting started, policy authoring, rules, architecture, security/threat model, evaluation, troubleshooting; CLAUDE.md, agents, skills | Done |
| 11 | Independent review and fixes | Reviews of architecture, security, false positives/negatives, docs accuracy, tests and fresh-checkout usability; significant findings fixed | Done |

## Definition of done

What a new developer can do, how, and the evidence observed on 2026-10-10. "Fresh-checkout review" means a subagent that copied the repository, committed it, and followed README and getting-started as written.

| # | A new developer can… | How | Evidence |
|---|---|---|---|
| 1 | Clone and install with documented commands | `pnpm install` (or `corepack pnpm install`), `pnpm exec playwright install chromium` | Fresh-checkout review: both exit 0 |
| 2 | Run the demo application | `pnpm demo` | Fresh-checkout review served it; `tests/e2e/demo.spec.ts` 6/6 |
| 3 | Run the CLI against the fixture project | `pnpm design-warden check --policy apps/demo/design-warden.policy.json` | PASS, exit 0 (3 findings suppressed by the time-boxed exception) |
| 4 | See a clean result for compliant code | `pnpm scenario run compliant-change` | `pass`, no findings |
| 5 | See actionable findings for seeded violations | `pnpm scenario run all` | 11/11 match; e.g. `hardcoded-color` fails at `OverviewPage.css:3` with `--color-text-danger` suggested |
| 6 | See that a legitimate new pattern is not rejected | `pnpm scenario run new-pattern` | `review`, no blocking finding |
| 7 | Inspect evidence, rule, location and remediation | Terminal report, JSON, `pnpm inspector` | `tests/e2e/inspector.spec.ts` 5/5 |
| 8 | Generate a machine-readable report | `--format json`, `--report <file>` | `reportVersion: 1`; the inspector opens it (e2e) |
| 9 | Observe the expected CI exit status | Exit codes 0/1/2/3 (README) | `cli.test.ts`; the example workflow's commands run locally: check exit 1, review jobs exit 0 |
| 10 | Run the automated tests | `pnpm test`, `pnpm test:e2e` | 195 passed; 11 passed (on 2026-10-10, before the backlog; current counts are in the latest progress-log entry) |
| 11 | Understand the security model and limits | [security.md](security.md), [SECURITY.md](../SECURITY.md), README "Status and limitations" | Reviewed by the security review; claims cite their tests |
| 12 | Add a rule with the documented workflow | Skill `add-design-rule`, [rules.md](rules.md), [policy-authoring.md](policy-authoring.md) | A subagent followed the skill in a scratch copy and added a `no-important` check end to end in about 9 minutes: typecheck, 197 tests, `eval`, `check:demo` and 11/11 scenarios passed there, and a real change failed with exit 1. Its doc friction (step order, `TEST_POLICY`, the pinned rule count, `StyleValue` limits, repeated numbers) is fixed in the skill. The check was added to this repository later, as backlog item B1 |
| 13 | Run the core checks with no model provider | Default: semantic review is off unless `--semantic` is given | Every command above; `tests/repo.test.ts` keeps network code to the stated modules |

## Next: build-out backlog

On 2026-10-10, after 0.1.0 was complete, the requester asked to "build everything we can" in the following sessions. **Status: all 16 items are done**, followed on 2026-10-11 by four independent reviews and one fix pass (see the progress log). What remains needs the requester (below). The process each item followed:
- implement it with tests, following CLAUDE.md (and the `add-design-rule` skill for checks);
- update the docs and numbers it affects;
- run the full verification: `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm check:demo`, `pnpm scenario run all`, `pnpm eval`;
- add a progress-log entry below, with the actual results.

| # | Item | Done when | Notes | Status |
|---|---|---|---|---|
| B1 | `no-important` check | The subagent's handoff patch, `no-important.patch`, is reviewed, applied and verified | A subagent built it by following the skill (197 tests passed in its copy). `git apply --check` was clean on 2026-10-10. It also updates the numbers in README and evaluation.md from the subagent's run: re-check them after applying, and write the progress-log entry yourself | Done 2026-10-10 |
| B2 | Typography scale rule | A demo-policy rule reports `font-size` literals and suggests `--font-size-*` tokens; benchmark labels; docs | Try `spacing-scale` with `properties: ["font-size"]` and `tokenPrefix: "--font-size-"` first. Its messages may say "spacing": make them name the scale if needed | Done 2026-10-10 |
| B3 | SARIF 2.1.0 reporter | `--format sarif` writes rules, results, locations, levels from the outcome, and fingerprints; tested; ci-integration.md explains `security-events: write` and Code Security | A pure `Report → string` function beside `reporters/markdown.ts` | Done 2026-10-10 |
| B4 | GitLab Code Quality reporter | `--format gitlab` (Code Climate subset: description, check_name, fingerprint, severity, location); tested; documented under "Other CI systems" | A pure function | Done 2026-10-10 |
| B5 | Tailwind arbitrary values | Literal `className` strings, and literal arguments to `clsx`/`cn`, are checked: `p-[13px]` and `text-[#e11d48]` are reported, `[var(--token)]` is allowed. The two known misses at `Limitations.tsx:15` become hits | A small tokenizer for class strings; no Tailwind dependency | Done 2026-10-10 |
| B6 | CSS-in-JS template literals | `styled.x`/`styled(X)`/`css`/`createGlobalStyle` templates are parsed with PostCSS; `${…}` expressions become insufficient evidence; lines map back to the file. The known miss at `Limitations.tsx:8` becomes a hit | Babel `TaggedTemplateExpression` | Done 2026-10-10 |
| B7 | Compare directories without git | `--base-dir <dir>` builds the change set with `git diff --no-index`, which works outside a repository | Reuse `parseNameStatus` and `parseUnifiedDiff` | Done 2026-10-10 |
| B8 | DTCG token input | `tokens.sources` accepts `*.tokens.json` (DTCG 2025.10): `$value`, `{alias}` references, `$type`, `$deprecated`; CSS names derived as `--group-name`; naming rule documented | | Done 2026-10-10 |
| B9 | SCSS | `.scss` parsed with `postcss-scss` (pin it; check its install scripts and advisories); `$variables` and mixins become insufficient evidence | New dependency | Done 2026-10-10 |
| B10 | Pin workflow actions to SHAs | Each `uses:` pinned to a full SHA, with the tag in a comment; both workflow copies identical | `git ls-remote https://github.com/actions/<name> refs/tags/<tag>` (network) | Done 2026-10-10 |
| B11 | npm packaging | An emit step to `dist/`; `files`, `exports` and `bin` per package; a test that packs the tarballs, installs them into a temp project and runs `design-warden check`; running from source still works | | Done 2026-10-10 |
| B12 | Approvals for review requests | An ADR first (OPEN_QUESTIONS #8): where approvals live, who may write them, loading from the base ref, expiry. Then suppression `by: approval` | A trust-boundary decision: make it explicit | Done 2026-10-10 |
| B13 | Accessibility pass | An optional review-only axe-core rule over the captured states, with axe injected from `node_modules` (no network) | New dependency | Done 2026-10-10 |
| B14 | Committed visual baselines | `capture` into a committed directory, compared on later runs; the environment-fingerprint requirement documented; a test | Mostly docs | Done 2026-10-10 |
| B15 | Provenance by tree shape | Tree edit distance on JSX trees as a second signal, evaluated on the scenarios | | Done 2026-10-10 |
| B16 | Vue SFC, then Svelte | Adapters that produce `JsxUsage`/`StyleValue` equivalents | Large; new dependencies | Done 2026-10-10 |

**Needs the requester.** Do not attempt these without them:
- the live-model evaluation (`pnpm eval:semantic --provider anthropic`): needs an API key and consent to send the scenario files;
- commits and pushes: only on an explicit request. The repository is https://github.com/EvanWieland/design-warden (private);
- Linux runs happen only in GitHub Actions (this machine has no WSL, Docker or `gh`), so they need a push. CI passes every step on Ubuntu since `71595b3`. macOS has never run.
- a first pull request, which would run the Design Warden workflow (check, visual and semantic jobs) on GitHub for the first time (open question 11);
- branch protection for `main` and the workflow file (GitHub settings), which the workflow's trust model assumes;
- npm: publishing the `@design-warden/*` packages, which are still `private` (the name and the organization are reserved; see the 2026-10-11 npm entry).

## Next: finishing backlog

On 2026-10-11 the requester asked to "finish the project": verify what was never run on GitHub, close the README's "Not yet" column (implement, or rule out with reasons), and release to npm. Decisions taken with them that day: the live-model evaluation is skipped; the packages are published publicly on npm while the GitHub repository stays private. Each item follows the build-out process above (tests first, docs and numbers, full verification, a progress-log entry).

| # | Item | Done when | Notes | Status |
|---|---|---|---|---|
| C1 | Pull-request workflow on GitHub | A test PR runs `design-warden.yml`: the check job fails on a seeded violation with annotations, the visual job reports changed screens; anything that breaks is fixed; the PR is closed unmerged | Open question 11 | Done 2026-10-11 |
| C2 | PR comments | The workflow keeps one Design Warden comment per pull request up to date, written by a job that never checks out or runs pull-request code; the markdown it posts comes from the JSON reports; tested | `pull-requests: write` only on that job; forks get a read-only token | Done 2026-10-11 |
| C3 | CSS-in-JS object styles | `css({…})`, `styled.x({…})`, `styled(X)({…})`, the `css` prop and nested selector objects are read like inline style objects; `sx` reports only unambiguous raw CSS (theme paths and numeric theme units are not raw values); benchmark labels; docs | | Done 2026-10-11 |
| C4 | Tailwind theme color classes | Color utilities whose name is a token (`bg-primary`) or a default-palette color (`bg-red-500`) are read as `var(--color-…)` references and judged by `token-usage`; sizes and keywords (`text-sm`, `border-2`) are not; benchmark labels; docs | A project that uses the default palette on purpose lists Tailwind's theme file as a token source | Done 2026-10-11 |
| C5 | Globally registered Vue components | `app.component('Name', Comp)` / `Vue.component(…)` registrations resolve template tags like imports do | | |
| C6 | Rename detection for `--base-dir` | Deleted and added files with identical or mostly identical content are paired as renames, so unchanged lines stay pre-existing | | |
| C7 | Region-to-source hints | Each changed visual region names the source files that style its nearest element, labelled as a heuristic | Or ruled out with a reason | |
| C8 | Scope decisions | Embeddings ruled out with a reason; providers reachable through the OpenAI-compatible adapter documented as untested; the README's "Not yet" column updated | | |
| C9 | Node 22 for the npm packages | The published `dist/` runs on Node 22 LTS, tested in CI; `engines` says so; the repository itself stays on Node 24 | Or a recorded reason why not | |
| C10 | Repository protection | CODEOWNERS for the workflows and policies; a branch ruleset if the plan allows it, otherwise documented | | |
| C11 | macOS | One manually triggered CI run on macOS passes, or its failures are fixed | Costs 10x Actions minutes on a private repository: run once | |
| C12 | Deferred minors | The starter policy's `$schema` resolves after copying; the Windows long-path build failure is in troubleshooting | | |
| C13 | npm release 0.2.0 | `design-warden` (unscoped) runs the CLI, the five scoped packages are public, all at 0.2.0; dry-run packs verified; published with the requester's 2FA approval; `npx design-warden` works from an empty directory; docs say how to install | Last, after the final review | |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Heuristics (provenance, duplicate names) produce noise | Review fatigue | Capped at `review`; per-class policy options; benchmark tracks false-positive rate |
| Visual capture flaky on real apps | Spurious review requests | Deterministic preset, stability loop, fingerprint guard; same-machine base/head; diffs never block |
| Model findings wrong or injected | Noise, misleading guidance | Verification against the files shown, capped at review, rejections reported, policy from base ref |
| Coverage gaps in real stacks | Missed findings in real apps | CSS, SCSS, CSS-in-JS templates, Tailwind arbitrary values, TSX/JS, Vue and Svelte are read natively; unread forms (Tailwind theme classes, other template languages, runtime styles) are documented in rules.md and become insufficient evidence or unparseable-file findings where detectable |
| Running from source requires Node ≥ 24.11 | Older CI images fail | `engines` field; documented. The npm packages run from emitted `dist/` (B11), tested on Node 24 only |
| PR controls workflow file on `pull_request` | Policy-ref protection bypassable | Documented: protect workflows, policy and tool source with CODEOWNERS/rulesets. The example workflow runs the tool and policy from the base branch |

## Progress log

- **2026-10-10.**
  - Inspected an empty workspace: Node 24.21, npm 11.19, git 2.55, pnpm 12.11.2 via corepack.
  - Ran six research passes plus a Claude Code conventions check.
  - Verified the TypeScript 7 API situation, typescript-eslint peer ranges, pnpm security settings and Anthropic SDK typings.
- **2026-10-10.**
  - Implemented `core`, `source-analysis`, `visual-analysis`, `semantic-review` and `cli`.
  - `pnpm typecheck` passes (TypeScript 7.0.2).
  - Tests: core 36, source-analysis 22, semantic-review 30, visual-analysis 8 (real Chromium), cli 19 — 115 passing, 0 failing.
  - Fixed during development:
    - Capture errors now name the step that failed.
    - Two test-design errors in the CLI tests.
    - A region-width expectation.
- **2026-10-10.**
  - Demo app built by a subagent against the contract (tokens and policy written by the lead). Full scan: PASS, 3 findings suppressed by the legacy exception.
  - Scenario harness built: temporary git workspaces, overlays plus exact edits, apply/reset, visual base cache.
  - 11 scenarios written with hand-made expectations. The first run exposed a real bug: provenance findings were anchored at the definition line, so changed-line scoping hid them. Fixed by carrying the component span. Result: **11/11 match**.
  - Further fixes:
    - token impact now compares resolved values (aliases followed);
    - suggestions prefer role-matching tokens, with exact matches winning and no suggestion when nothing is close;
    - parallel scenario runs isolated (unique run directories, atomic base cache);
    - the static server no longer crashes when a file disappears;
    - oversized files are reported instead of parsed.
  - Inspector service written and tested (loopback, Host and Origin checks, fixed endpoints). The UI is being built by a subagent.
  - Benchmark: 12 files, 52 labels; **96.1% precision, 94.2% recall**. The misses are documented traps and limitations, pinned by a test.
  - Semantic evaluation: replay pipeline 3/3 labels, 0 false alarms; live model not run (no key).
  - CI workflows written and validated as YAML. Their commands were run locally end to end (check with `--policy-ref`, GitHub outputs and summary, capture --serve ×2, visual compare). Not executed on GitHub.
  - Docs, Claude Code guidance (CLAUDE.md, 3 skills, 3 agents) and starter policy written.
  - `pnpm test`: **16 files, 150 tests passed** (24.8 s).
- **2026-10-10 (reviews and fixes).**
  - Inspector UI finished by a subagent; Playwright e2e for the inspector and the demo.
  - Four independent reviews by subagents: security, architecture, false positives/negatives, docs/tests/dependencies. Significant findings fixed:
    - **Security:**
      - Change sets could be evaded through file names and `-diff` attributes. Now: NUL-separated name-status, `--text` patches, and a fail-closed whole-file fallback.
      - Repository text could inject workflow commands into GitHub logs. Now wrapped in `::stop-commands::` with a random token.
      - Findings and provenance sections of the prompt were sent unredacted. Now redacted and fenced.
      - The capture browser could open WebSockets to other hosts. Now blocked.
      - Autolinks and `javascript:` links reached summaries. Now escaped or stripped.
      - Harness edits now go through `resolveInside`.
      - CI ran the pull request's own copy of the tool. Now it runs a base-branch worktree installed with `--ignore-scripts`.
    - **False positives and negatives:** type casts, local style constants, conditional color props, `??`/`||` fallbacks, `calc()` multipliers, `var()` fallbacks, translucent colors, token redefinition, input types, ARIA-role imitations, head-noun alias matching. The benchmark gained 17 audit labels.
    - **Architecture:**
      - The model SDK is imported lazily.
      - Duplicated timeout and rule-scope logic removed; the guidance excerpt moved to core.
      - Setup errors exit 2; capture exits 3 when every state fails.
      - The review-only CI jobs report and gate on their own engine only (`--only`).
    - **Docs and tests:**
      - Claims corrected: package isolation, Origin handling, exit codes, network boundary.
      - Windows long paths handled; `check:demo` pinned to a date; vitest declared per package; a dependency audit added to CI.
  - Fresh-checkout review by a subagent: it copied the repository, committed it, and followed README and getting-started as a new user. Every documented step worked, and the first successful `check` came 125 s after the copy. Its findings, all fixed:
    - **Latent:** the demo's legacy exception expires on 2027-03-31, and a browser test asserted PASS on an unpinned full scan. The test now pins `--today`; README and getting-started explain the expiry.
    - **Harness:**
      - `scenario run` refuses to run while a scenario is applied to `apps/demo`.
      - `scenario reset` removes the directories that `apply` created.
      - `scenario --help` prints usage.
    - **Dry run:** the summary said "sent". Reports now carry `semantic.dryRun`, and the terminal, markdown and inspector views say "not sent".
    - **Docs:**
      - Quick start mentions `corepack pnpm` and that Chromium is needed for `pnpm test`.
      - Example outputs go under `.design-warden/`; the CI snippet has a PowerShell variant.
      - Two broken links fixed; Chromium's on-disk size corrected; plural grammar in `policy validate` fixed.
  - Add-a-rule review by a subagent: it followed the `add-design-rule` skill in a scratch copy and added a `no-important` check end to end. From its findings, the skill was corrected: the policy rule now comes before the benchmark, `TEST_POLICY` and the pinned rule count are named, `StyleValue`'s limits and where files are skipped are explained, and every place that repeats benchmark numbers is listed.
  - Verified after all fixes on 2026-10-10 (Windows 11, Node 24.21):
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **195 tests passed** (25.8 s).
    - `pnpm test:e2e`: **11 passed** (21.6 s), including the demo specs, whose first run was earlier the same day.
    - `pnpm check:demo`: PASS (3 suppressed), 11/11 rule examples.
    - `pnpm scenario run all`: **11/11** (5.9 s).
    - `pnpm eval`: 69 labels, 66 TP / 1 FP / 3 FN, **98.5% precision, 95.7% recall**.
    - `pnpm audit`: no known vulnerabilities.
  - The example workflow's commands for all three jobs were re-run locally in a scratch repository (see ci-integration.md). They have not been run on GitHub.
- **2026-10-10 (B1: `no-important`).**
  - Reviewed the handoff patch: contract in the doc comment, flag read from PostCSS `decl.important` (which also parses `! IMPORTANT`), no flag for comments, strings or `url()`, design system excluded by scope. Applied the test half first: 31/31 source-analysis tests failed with "unknown check". After the implementation: 31/31 passed.
  - The verification exposed a latent inspector bug. `app.test.ts` "serves a real run artifact" failed with `ECONNRESET`, also when run alone (2 of 2 runs).
    - Cause: `compareCaptures` compared all 16 capture pairs synchronously. Recent run reports show the visual engine blocking the event loop for 3.8–10.8 s. When the block exceeded the server's 5 s keep-alive timeout, the server closed the reused socket before reading the next poll.
    - Fix: `compareCaptures` is async and yields between captures. New test: "yields to the event loop while comparing" (failed, then passed). The inspector test then passed 2 of 2 runs alone.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **198 passed** (25 s).
    - `pnpm test:e2e`: **11 passed** (19.1 s).
    - `pnpm check:demo`: PASS (3 suppressed), 14/14 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 15 files, 75 labels, 72 TP / 1 FP / 3 FN, **98.6% precision, 96.0% recall**, 11.0% insufficient evidence. These match the numbers the patch wrote into README and evaluation.md.
- **2026-10-10 (B2: typography scale).**
  - No new check: the demo rule `typography/scale` is `spacing-scale` with `properties: ["font-size"]` and `tokenPrefix: "--font-size-"`, linked to the design skill's Typography section. The check's messages now name the configured scale ("is not on the `--font-size-*` scale") instead of saying "spacing". Tests for the new wording and the typography rule failed first (3 of 72), then passed.
  - Benchmark: `typography.css` (6 hits, tricky negatives, and the `font` shorthand as a labelled known miss). The first run also showed an unlabelled hit at `AuditCases.tsx:14`: a style object built elsewhere, where the color and spacing rules already expect insufficient evidence. The new rule reports it for the same reason, so it was labelled as expected.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **200 passed** (28 s).
    - `pnpm test:e2e`: **11 passed** (19.0 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 16 files, 83 labels, 79 TP / 1 FP / 4 FN, **98.8% precision, 95.2% recall**, 11.3% insufficient evidence.
- **2026-10-10 (B3: SARIF).**
  - `reporters/sarif.ts`, a pure `Report → string` function, and `--format sarif`. Results are the findings that count toward the outcome (no suppressed or pre-existing ones). Levels follow the outcome; fingerprints are the finding ids; text fields only. An engine that failed closed writes no SARIF. Three tests failed first (missing module; `--format sarif` rejected with exit 2), then passed.
  - Validated against the official SARIF 2.1.0 schema, fetched from json.schemastore.org and converted with zod's `fromJSONSchema`. The outputs of `hardcoded-color` and six other scenario workspaces are valid; together they cover `error`, `warning` and `note`. A negative control with an invalid `level` was rejected. One deviation: zod's converter treats the schema's `uri-reference` format as an absolute URL, so that format was relaxed for the check; the paths are relative references, as GitHub requires.
  - ci-integration.md: contents, fingerprints, paths, `security-events: write`, Code Security, and a code-scanning job pinned to `github/codeql-action/upload-sarif` v4.38.3 by commit SHA (`git ls-remote`, 2026-10-10). The upload to GitHub has not been run.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **203 passed** (37 s).
    - `pnpm test:e2e`: **11 passed** (26.3 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged (79 TP / 1 FP / 4 FN).
- **2026-10-10 (B4: GitLab Code Quality).**
  - `reporters/gitlab.ts`, a pure function, and `--format gitlab`: `description`, `check_name`, `fingerprint`, `severity` (fail → major, review → minor, info → info), `location.path` and `location.lines.begin`. It holds the same findings as SARIF minus those without a location, which GitLab cannot place, and writes nothing after an engine failure. Tests (end-to-end, paths, missing locations, engine failure) failed first, then passed.
  - ci-integration.md "Other CI systems" now has a `.gitlab-ci.yml` job: trusted tool and policy from the target branch, a whole-project scan (the merge-request widget compares against the target branch's report), and an upload only after exit 0 or 1. Neither the GitLab job nor the GitHub code-scanning job has been run on its platform. No YAML parser is installed here (none in the repository, Python or pnpm 12), so both snippets were checked by reading, not by a parser. (Corrected on 2026-10-11: playwright-core bundles one, and every workflow file and YAML snippet parses with it; see that day's entry.)
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **206 passed** (36 s).
    - `pnpm test:e2e`: **11 passed** (26.9 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged (79 TP / 1 FP / 4 FN).
- **2026-10-10 (B5: Tailwind arbitrary values).**
  - `tailwind.ts` parses one class (variants, negative values, opacity, `!`, type hints, arbitrary properties, the v4 `(--var)` shorthand) into the property and value it sets. `styleValues()` emits these as `jsx-class` values from `className` literals and from `clsx`/`cn`/`classnames`/`cx`/`twMerge`/`twJoin` arguments, so the color, spacing, typography and token checks apply unchanged. Messages name the class. No Tailwind dependency; theme classes (`p-4`) are not judged, because they depend on the Tailwind config.
  - Tests first: two positive tests failed (no findings), then passed. During self-review, the first version's skipping of classes next to `${…}` turned out to only cause misses, such as `${v}:p-[13px]`. Partial classes are already rejected by bracket matching. A test that failed on that miss came first, then the skip was removed. A deliberate mutation of the line counting made the test fail, which confirms it covers that logic.
  - Benchmark: `Tailwind.tsx` (14 labels, all hits, plus tricky negatives); the two Tailwind misses at `Limitations.tsx:15` are now hits.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **210 passed** (61 s).
    - `pnpm test:e2e`: **11 passed** (47.4 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 17 files, 97 labels, 95 TP / 1 FP / 2 FN, **99.0% precision, 97.9% recall**, 9.4% insufficient evidence.
- **2026-10-10 (B6: CSS-in-JS templates).**
  - `styleValues()` reads `styled.x`, `styled(X)`, `.attrs()`/`.withConfig()`, `css`, `createGlobalStyle`, `keyframes` and `injectGlobal` templates. Each `${…}` becomes a placeholder of the same length: a comment where it stands alone (a mixin), a word elsewhere. So PostCSS lines and columns map back to the file exactly. A declaration whose value contains a placeholder is insufficient evidence (`css-in-js` source, value unknown); computed property names are skipped. A template PostCSS cannot parse (for example with `//` comments) becomes one insufficient-evidence value per style rule, not a silent pass.
  - Tests first: two tests failed (no findings), then passed. Before implementing I corrected one expectation: an unparseable template is located at its tag, not at the column I had first written.
  - Benchmark: `CssInJs.tsx` (11 labels, all hits, plus tricky negatives); `Limitations.tsx:8` is now a hit. The unparseable template is also labelled for spacing and typography: like an unreadable inline style object, it is unknown to every style rule.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **212 passed** (36 s).
    - `pnpm test:e2e`: **11 passed** (36.9 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 18 files, 108 labels, 107 TP / 1 FP / 1 FN, **99.1% precision, 99.1% recall**, 13.0% insufficient evidence.
- **2026-10-10 (B7: `--base-dir`).**
  - `dirChangeSet` in core: both trees are listed with the policy's project globs plus the policy file and token sources. A whole-directory `git diff --no-index` was tried first; it includes `node_modules`, ignores `.gitignore` and reports inconsistent paths. Byte-different files are diffed one by one with `git diff --no-index -U0` (exit 1 means "differs"), reusing `parseUnifiedDiff` and the git-ref path's safe patch options, now shared as `PATCH_OPTIONS`. Base files are read through `resolveInside`. `--base` with `--base-dir` is a usage error (exit 2). Terminal and inspector omit the empty merge-base SHA.
  - Tests first: the core tests (two temp trees outside any repository) and the CLI test failed, then passed. The test for combining `--base` with `--base-dir` first passed for the wrong reason (unknown option); after the change it fails with the intended message, "--base and --base-dir cannot be combined".
  - Real use: the `hardcoded-color` scenario workspace against a clean `apps/demo` with `--base-dir` gives the same result as `--base main`: 2 changed files, 1 blocking finding at `OverviewPage.css:3:3`.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **216 passed** (39 s).
    - `pnpm test:e2e`: **11 passed** (36.5 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged (107 TP / 1 FP / 1 FN).
- **2026-10-10 (B8: DTCG token files).**
  - Checked the 2025.10 spec first (designtokens.org format and color modules): `$root`, `$extends`, JSON Pointer `$ref`, `$deprecated` inherited from groups, 14 color spaces with an optional 6-digit `hex`, and `{value, unit}` dimensions and durations.
  - `parseDtcgTokens` turns a `*.tokens.json` file into the same `TokenDef`s as CSS. Names are kebab-cased paths (Style Dictionary's convention). References become `var()` and resolve as in CSS. Colors use their hex fallback, computed sRGB hex, or a CSS color function; composite values are kept as data. `$type`/`$deprecated` are inherited and `$extends` deep-merged. A JSON token source is parsed as a file of kind `json`, so the shared-change check sees edits to it. `token-usage` reports deprecated tokens, and every suggestion skips them (`TokenSet.canSuggest`). The schema description was updated and `pnpm schema` regenerated.
  - Tests first: the parser test, the policy test and the shared-change test failed (parser missing; the JSON file was read as CSS), then passed. One test fixture was wrong, not the code: the shared `src/ds/tokens.css` was no longer a token source in that policy, so its definitions correctly counted as redefinitions; the test now blanks it.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **219 passed** (47 s).
    - `pnpm test:e2e`: **11 passed** (38.5 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged (107 TP / 1 FP / 1 FN). The demo keeps CSS token sources.
- **2026-10-10 (B9: SCSS).**
  - Dependency check before installing `postcss-scss`: version 4.0.9 (latest), MIT, by PostCSS's author, no dependencies, no install scripts (`npm view` and the installed `package.json`), peer `postcss ^8.4.29` (we have 8.5.29), types included. Added with `--save-exact`. The lockfile passed pnpm's supply-chain policy, and `pnpm audit` found no known vulnerabilities.
  - `.scss` is parsed with postcss-scss into the same tree as CSS. A value with a `$variable` or `#{}` is insufficient evidence. A literal variable is checked like a custom property, and a variable built from variables is skipped. Interpolated property names are skipped. `@include name(args)` without a content block is insufficient evidence for each style rule. `!important` in SCSS is now reported. CSS-in-JS templates are also parsed with postcss-scss, so stylis-style `//` comments no longer make them unreadable.
  - Tests first: the SCSS test and the updated CSS-in-JS test failed, then passed; the shared test policy's include gained `scss`. Benchmark: `styles.scss` (11 labels, all hits). In `CssInJs.tsx`, the `//`-commented template's three insufficient-evidence labels became one hit, and a template with an unmatched brace keeps the unparseable case. The demo policy's include and the corpus glob gained `scss`.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **220 passed** (50 s).
    - `pnpm test:e2e`: **11 passed** (37.6 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 19 files, 120 labels, 119 TP / 1 FP / 1 FN, **99.2% precision, 99.2% recall**, 15.8% insufficient evidence.
    - `pnpm audit`: no known vulnerabilities.
- **2026-10-10 (B10: pinned actions).**
  - `git ls-remote` showed the current releases: checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2 (all lightweight tags, so the listed SHA is the commit). The workflows used v5, v5 and v4. From the release notes: setup-node v5 caches automatically when `package.json` has a `packageManager` field, and ours names pnpm, which is not installed until corepack runs later in the job. Later majors only do this for npm. None of the newer majors changes an input we use (`fetch-depth`, `persist-credentials`, `node-version`, `name`, `path`). Ruling: move to the v7 releases and pin them.
  - New test in `tests/repo.test.ts`: every `uses:` in both workflows, the example copy and ci-integration.md is a 40-character SHA with a `# vX.Y.Z` comment. It failed on the unpinned lines, then passed after pinning. The two workflow copies stay identical (existing test).
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **221 passed** (48 s).
    - `pnpm test:e2e`: **11 passed** (39.5 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged.
    - The workflows have still not run on GitHub.
- **2026-10-10 (B11: npm packaging).**
  - Probed first: TS 7.0.2 supports `tsc -b`, `composite`, declarations and `rewriteRelativeImportExtensions`.
  - Each of the five packages has a `tsconfig.build.json` with project references. `pnpm build` (`tsc -b packages/cli/tsconfig.build.json`) emits every `dist/` in dependency order; the symlinked workspace imports resolve to the referenced projects' declarations. `publishConfig` swaps `exports` (with `types`) and `bin` to `dist/`. `files` ships `dist/` (core also `schema/`), and `engines` is `>=24.11`, the tested version. The CLI reads its version from `package.json` at runtime: a JSON import cannot be emitted under `rootDir: src`. The packages stay `private`.
  - Test first: `tests/pack/pack.test.ts`, run by `pnpm test:pack` and excluded from `pnpm test` (it needs the network). It failed with "Missing script: build", then passed: build, `pnpm pack` × 5, `npm install --ignore-scripts` of the tarballs into a fresh project, `design-warden --version` = 0.1.0, and `check` from `node_modules` exits 1 with the expected finding. It also asserts that `workspace:*` became `0.1.0` and that no `src/` is shipped. Duration 15.8 s (npm cache warm). Added to CI.
  - `pnpm install --frozen-lockfile --offline`: the lockfile is still in sync.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **221 passed** (45 s), with `dist/` folders present.
    - `pnpm test:e2e`: **11 passed** (38.6 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged.
    - `pnpm test:pack`: 1 passed.
- **2026-10-10 (B12: approvals).**
  - ADR 0012 first. Approvals live in the policy (`approvals[]`): fingerprint, rule, optional file, reason, approver, required expiry. They are read wherever the policy is read (the base ref in CI), so a change cannot approve its own review requests. They clear `review` findings only, never `fail`. Any edit to the flagged code changes the fingerprint. Per-pull-request memory is left to code-scanning dismissals. The decision and its alternatives are recorded so the requester can revisit it.
  - Implementation: schema (with an unknown-rule check), `suppressed.by: 'approval'` with `approvedBy` (applied in `finalizeFindings` after the outcome is known), one `policy/changed` note per added, changed or removed approval, and an approval count in `policy validate`. The JSON schema was regenerated.
  - Tests first, all failing before the change: approvals clear review findings but not blocking ones; under `--policy-ref`, a change's own approvals have no effect; expired approvals do not apply; an unknown rule fails validation with the exact message; policy-diff notes. One test setup was wrong (it parsed the invalid policy in the helper) and was fixed to assert the CLI's message.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **225 passed** (42 s).
    - `pnpm test:e2e`: **11 passed** (37.2 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged.
- **2026-10-10 (B13: accessibility).**
  - Dependency check before installing axe-core: version 4.14.0, published 2026-10-05 (older than pnpm's one-day minimum release age), MPL-2.0 (used unmodified), no dependencies, no install scripts. Added with `--save-exact`; `pnpm audit` found no known vulnerabilities.
  - `captureAll({ accessibility: { tags } })` evaluates `axe.min.js` from `node_modules` in each page after the screenshot (no request, no CSP issue) and stores violations, or `accessibilityError`, in the validated manifest. The `accessibility` check compares head with base and reports violations new in head as `probable-violation` (review at most); a state axe could not check is insufficient evidence. `accessibilityCapture()` passes the policy's tags to `design-warden capture` and the harness. The demo policy gained `a11y/no-new-violations`.
  - Tests first for the comparison and the capture (both failed: no function, no data). The CLI wiring was written before its end-to-end test (capture base and head pages, `check --only visual`, expecting `html-has-lang` as review). To compensate, a deliberate mutation disabling the wiring made that test fail.
  - Real use: `pnpm scenario run token-change --visual` (fresh base cache) still matches (`review`). axe checked 16/16 demo states with no violations and no errors, so the violet primaries add none.
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **229 passed** (35 s).
    - `pnpm test:e2e`: **11 passed** (26.4 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged.
    - `pnpm audit`: no known vulnerabilities.
- **2026-10-10 (B14: committed baselines).**
  - The mechanics already worked: `capture --out <dir>` writes a manifest plus PNGs that later runs can compare with, and the fingerprint check refuses a baseline from another environment. A new CLI test covers the whole flow: capture a baseline into the project, capture a changed page, compare (one review finding), then compare with a baseline whose fingerprint was edited (visual engine failed; outcome `review` by its failure policy). It failed only on the one missing piece, guidance in the refusal. The error now says how to capture a matching baseline.
  - ci-integration.md "Committed baselines": the environment requirement (capture in the pinned container; re-capture after a Playwright upgrade), reading the baseline from the base-branch worktree so a pull request cannot edit its own reference, review of baseline updates, `*.png binary`. Capturing in the container was not run here (no Docker).
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **230 passed** (36 s).
    - `pnpm test:e2e`: **11 passed** (25.4 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged.
- **2026-10-10 (B15: provenance by tree shape).**
  - `jsxUsages` records each element's enclosing element. `shapeTree` builds an ordered tree of a component's elements, normalized like the composition features: generic `div`/`span`/`p` dropped with their children moved up, and adjacent identical subtrees counted once. `treeEditDistance` is Zhang-Shasha with unit costs, and similarity is the lower of composition (Jaccard) and shape. The reference loop skips the tree edit distance when composition alone cannot beat the current best.
  - The normalization was decided after reading the scenario edits. `hardcoded-color` adds a `<p>` and `compliant-change` adds a second `<Select>`, and both components are "established" in the hand-written expectations; a raw tree would have called them modified.
  - Tests first: the edit-distance test (including Zhang and Shasha's classic example, distance 2) and two provenance tests failed before the change. A rearranged component and the same components in another layout were both "established". A third test (repetition and wrappers stay established) already passed and guards the normalization.
  - Evaluation on the scenarios: 11/11 match, and every provenance classification is unchanged from the previous (Jaccard-only) runs. Only similarity values moved: `SettingsPage` 0.88 → 0.75, `CustomersPage` 0.44 → 0.40, and `ActivityTimeline`'s nearest reference (still novel).
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **234 passed** (35 s).
    - `pnpm test:e2e`: **11 passed** (25.3 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: unchanged.
- **2026-10-10 (B16: Vue, then Svelte).**
  - Dependencies, checked before installing. `@vue/compiler-dom` 3.5.43: MIT, published 2026-09-17, chosen over `@vue/compiler-sfc` (which adds compiler-ssr, magic-string and a second PostCSS); +9 packages, including Babel 7 for Vue's own use. `svelte` 5.57.2: MIT, published 2026-10-06, +15 packages, because the parser ships with the compiler. No install scripts; pinned exactly; `pnpm audit` found no known vulnerabilities.
  - Shared adapter seam in `templates.ts`: neutral elements whose attribute values are Babel-like nodes (string literals, or expressions parsed at their file offset), `<style>` blocks parsed in place (the rest of the file blanked, so positions are exact), and the script likewise for imports. `templateUsages` and `templateDefinition` serve both frameworks; `jsxUsages`, `componentDefinitions` and `styleValues` branch on `file.template`, so every check runs unchanged. `vue.ts` maps kebab-case component attributes to camelCase props, `:prop`, `v-model` and `v-bind` spreads; `svelte.ts` maps `{expr}`, mixed text (as a template literal), `bind:`, `class:` and `style:` directives and spreads, and walks block fragments. A static `style="…"` is now read as an inline style (JSX gets this too).
  - Tests first: two Vue and two Svelte tests failed (unsupported file type), then passed. Two of my own test assertions were wrong and were fixed: Vitest's `toMatchObject` with `error: undefined` requires the key. During the refactor the Vue tests kept passing.
  - Startup: importing the compilers eagerly added about 470 ms to every run (`svelte/compiler` ESM about 400 ms). A repository test now forbids static imports of them, and the adapters `require` the CommonJS builds on first use. `design-warden --version` measured 589–683 ms afterwards, against 684–1,427 ms before.
  - Benchmark: `VueOrders.vue` and `SvelteOrders.svelte`, 6 labels each, all hits, with tricky negatives (kebab-case and shorthand required props, spreads, tokens, global components).
  - Verified:
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **239 passed** (86 s).
    - `pnpm test:e2e`: **11 passed** (41.0 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 21 files, 132 labels, 131 TP / 1 FP / 1 FN, **99.2% precision, 99.2% recall**, 15.9% insufficient evidence.
    - `pnpm test:pack`: 1 passed.
    - `pnpm audit`: no known vulnerabilities.
- **2026-10-11 (independent review of B1–B16, and one fix pass).**
  - Four reviews by subagents, each read-only or in a scratch copy: architecture; false positives and negatives (an audit with new probe files); security; fresh checkout, docs and tests. Together they reported 2 Critical and about 20 Important findings, plus Minor ones. Every Critical and Important finding is fixed. Each fix has a test that failed first; for the three fixes whose tests were written after the code (`classNames`, class constants, `@include x()`), a mutation of the fix made the test fail. Minor findings are deferred and listed at the end of this entry.
  - **Readers** (audit, security, architecture):
    - One declaration reader for every CSS source (files, `<style>` blocks, inline `style` strings, CSS-in-JS templates). `no-important` now covers all of them. Inline styles that PostCSS cannot parse, and computed CSS-in-JS properties, are insufficient evidence instead of disappearing (a security finding: `style="color: #e11d48; /*"` passed). Svelte and Vue inline styles that mix literals and expressions keep their literal findings. The quadratic re-blanking is gone: a 304 KB TSX file with 4,000 inline styles takes 263 ms (the reviewer measured 80 s for 192 KB), and a Vue file with 2,000 style blocks 171 ms (121 s).
    - Critical: Vue's same-name shorthand (`<Badge :tone>`) and Svelte 5 snippet props (`{#snippet emptyState()}`) failed as missing props. Both now count as props.
    - A comment or a second mixin after a CSS-in-JS mixin no longer makes the template unreadable (an evasion path: three review findings instead of one failure). `classNames()` and same-file class constants are read, and `@include x()` is no longer insufficient evidence.
    - Vue and Svelte markup in another language (`<template lang="pug">`) or loaded with `src` is unparseable (review) instead of passing silently. Custom Vue blocks with `src` are allowed, since they are never read. Namespaced `<DS.Badge>` resolves in templates, as in JSX.
    - `spacing-scale` has a `units` option; the demo's typography rule leaves out `em`, which was suggested a token as if it were `rem`.
    - JSX in `.js` files is parsed (`.js`/`.jsx` use the `jsx` plugin only); such files used to be unparseable.
  - **Gate, approvals, change sets** (architecture, security, docs):
    - Approvals are decided inside `decideOutcome`. Fingerprints include the whole span of multi-line findings, so editing an approved component brings its review request back (the docs reviewer reproduced the gap). Duplicate fingerprints are rejected, and `policy/changed` compares approvals by content.
    - SARIF and GitLab reports are not written when any engine failed or was incomplete. Before, a `review` or `fail-open` failure policy wrote an empty report, which code scanning reads as fixed alerts.
    - `--base-dir`: the policy and token sources are always compared, so a head policy that excludes itself can no longer hide `policy/changed`. A file named `-` no longer makes `git diff --no-index` read stdin.
    - DTCG: circular `$extends` is an error, expansion stops at 100,000 tokens, and token sources have the 2,000,000-character cap. A 74-byte file had hung the tool.
  - **Provenance:** trees over 300 nodes are compared by composition only (the reviewer measured 3.8 s for one 1,093-node pair). References are ranked by composition, so the loop stops at the first one that cannot win. A reference file changed by the pull request is read from the base, so editing a reference cannot vouch for new code.
  - **Accessibility:** violations are matched by element HTML, counted, instead of axe's positional selectors (an inserted image made two existing violations look new). The accessibility-only path checks the environment fingerprint like `visual-diff`, through one shared `readCapturePair`. The manifest records the axe-core version and tags. A mismatch, or captures made without axe, gives one insufficient-evidence finding.
  - **CLI and CI:** `capture --serve` exits 2 when the directory has no `index.html` (it used to fail all 16 states and exit 3). The Playwright container is pinned by digest, looked up from the registry and checked against the downloaded index, and a repository test ties its tag to the npm version. The pack test installs with `npm install --before=2026-10-11`, quotes arguments for the Windows shell and removes its temporary directory. The `--base` with `--base-dir` test asserts its message: it had passed with the guard deleted.
  - **Docs** (docs and architecture reviews):
    - the `add-design-rule` skill: `StyleValue`'s five sources, and read styles only through `styleValues()`;
    - ADRs 0003, 0009, 0011 and 0012, the ADR index, and open question 3;
    - architecture.md;
    - rules.md: parsers, Tailwind in templates, `no-important` scope, unread patterns, Vue and Svelte gaps, `units`, the provenance cap, accessibility matching;
    - "In your own repository" in the README, getting-started and the starter policy README: run from a checkout, both forms shown;
    - ci-integration.md: SARIF `actions: read` and fork pull requests, incomplete-run wording, job timeouts in the snippets, and the missing build and head-capture steps for committed baselines;
    - policy-authoring.md: an `approvals[]` row and a made-up example fingerprint (the old one was a real finding id);
    - security.md: the parsers, and `--base-dir` trusting the head policy;
    - timings measured again.
  - **Benchmark:** 9 new labels, all hits (class constant and `classNames()`, namespaced components, `!important` in an inline style, a `<style>` block and a CSS-in-JS template, a mixed Svelte inline style), and tricky negatives for the rest (an `em` font size, `@include truncate()`, a mixin followed by a comment, Vue's `:tone`, a Svelte snippet). They were written after the fixes, like the audit cases. The pinned baseline moved the known `font` shorthand miss to line 18.
  - **YAML:** playwright-core bundles a YAML parser (`lib/utilsBundle.js`, export `yaml`). All three workflow files and the three YAML snippets in the docs parse with it, and it rejects malformed input.
  - Verified (2026-10-11, Windows 11, Node 24.21):
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **268 passed** (53 s).
    - `pnpm test:e2e`: **11 passed** (34.2 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11** (11 s).
    - `pnpm eval`: 21 files, 141 labels, 140 TP / 1 FP / 1 FN, **99.3% precision, 99.3% recall**, 15.6% insufficient evidence.
    - `pnpm test:pack`: 1 passed (17 s), no DEP0190 warning, temporary directory removed.
    - `pnpm audit`: no known vulnerabilities.
    - The committed-baselines commands exactly as documented: demo build, capture 16/16 into `apps/demo/design-warden-baseline`, build, capture 16/16 into `.design-warden/head`, compare: PASS, exit 0. The manifest records axe-core 4.14.0 and its five tags. The baseline directory was deleted afterwards.
    - "In your own repository": both forms against a scratch repository made from `examples/policy`, with a hardcoded color added: FAIL at `src/app/welcome.css:6:9`, exit 1.
    - `pnpm scenario run token-change --visual`: ok, 35.5 s cold and 22.0 s warm (comparison 5–6 s).
  - Deferred minors (not fixed):
    - **Architecture:**
      - `styleValues` is not cached per file, so each of the five style rules walks the file again.
      - Reporter duplication: the `fix` expression and the `!suppressed && !preexisting` filter appear five times each, and `repoPath` lives in `sarif.ts`.
      - Duplication in `jsx.ts` and `provenance.ts` (`features`/`label`, `topLevelFunctions` run twice, the base shape computed twice).
      - Only the first rule using visual-diff, accessibility or provenance takes effect, and a second one is ignored silently. A `ruleFor()` helper and a load-time duplicate check would fix this.
      - `dirChangeSet` runs one `git diff --no-index` after another (about 64 ms each).
      - Dead code: dynamic imports of already-loaded modules in `tools/harness/src/run.ts`, a nested `else` in `main.ts`, unused exports.
      - `axe.min.js` is read once per state.
      - No repository test for "Playwright only through `./capture`".
    - **Detection** (audit):
      - Negative and tiny lengths get odd messages (`-12px` gets no suggestion; `2px` is suggested `--space-0`).
      - Sass arithmetic is judged by its operand (`math.div(26px, 2)`).
      - A literal in a multi-line Sass map is reported one line early.
      - The fluid middle term of `clamp(…, 1vw + 0.5rem, …)` is reported.
      - Documented, not fixed: Tailwind's v3.3 `[--var]` shorthand, `utils.cn()`, renamed Emotion imports, helper templates, literal-branch and CSS-returning interpolations, Vue `v-bind()` in styles, array styles, named slots, `<style lang="postcss">`.
    - **Security:** two identical flagged lines share a base fingerprint with a `-n` suffix, so a new identical line placed earlier in the file takes over an approved id.
    - **Tests and housekeeping:**
      - `visual-scenarios.test.ts` asserts at least 8 changed captures where all 16 change.
      - `.design-warden/runs` grows by about 25–30 MB per `pnpm test`.
- **2026-10-11 (renamed to Design Warden).**
  - Why: the npm package `design-guard` and the `@design-guard` scope, which has a published `@design-guard/core`, belong to an unrelated AI web-design project. Our packages could not be published under that name. `design-warden` was free as an npm package, as an npm scope and as a GitHub account.
  - A script replaced every occurrence in text files: 524 in 126 files. It covered `Design Guard`, `design-guard`, `DESIGN_GUARD`, `designGuard`, and the `dg` abbreviation (temporary-directory prefixes, a troubleshooting path, research notes). Four files were renamed: both workflow copies and both policy files.
  - User-facing names that changed:
    - the CLI is `design-warden`;
    - the packages are `@design-warden/*`;
    - the policy file is `design-warden.policy.json`;
    - the output directory is `.design-warden/`;
    - the inline directive is `design-warden-ignore-next-line`;
    - the provider variables are `DESIGN_WARDEN_OPENAI_*`;
    - the report's `tool.name` changed, and the SARIF fingerprint key is `designWarden/v1`.
  - The old names are not accepted as aliases, because nothing was published. Earlier entries in this log were renamed as well, so the commands in them still run.
  - Scenario expectations: three `whyItMatters` texts changed, plus the policy file name in `policy-weakening` (its `scenario.json` and `edits.json`). No expected outcome changed.
  - Tests first: with only the tests renamed (package imports kept), 14 tests failed against the old code. They covered the workflow and policy paths, the directive, the report headers and the SARIF driver name. After the full rename they pass.
  - The old `.design-guard/` output directory (28 MB) was moved out of the repository to the session's scratch directory. It held run workspaces, caches, a stale handoff patch, and a leftover scenario-apply state for a deleted temporary directory.
  - Verified (2026-10-11, Windows 11, Node 24.21):
    - `pnpm install --frozen-lockfile` accepted the renamed lockfile.
    - `pnpm schema` regenerated an identical file.
    - `pnpm typecheck`: exit 0.
    - `pnpm test`: 17 files, **268 passed** (48 s).
    - `pnpm test:e2e`: **11 passed** (29.0 s).
    - `pnpm check:demo`: PASS (3 suppressed), 17/17 rule examples.
    - `pnpm scenario run all`: **11/11**.
    - `pnpm eval`: 21 files, 141 labels, 140 TP / 1 FP / 1 FN, 99.3% precision and recall, 15.6% insufficient evidence.
    - `pnpm test:pack`: 1 passed.
    - `pnpm audit`: no known vulnerabilities.
  - npm: a placeholder, `design-warden@0.0.0`, is prepared to reserve the unscoped name. It contains only a README and package.json (337 B). Publishing it needs the requester's npm login. `designwarden`, `design_warden` and `design.warden` are free as well, so npm's rule against names that differ only in punctuation will not refuse it.
  - Independent review (one subagent, from a fresh context). It found nothing functionally broken. In a scratch copy of the files, all four "In your own repository" commands gave the expected FAIL, the new directive was recognised, and the old `DESIGN_GUARD_OPENAI_BASE_URL` was refused. It also found leftovers, all fixed:
    - the `$GUARD` variable in both workflows and in `docs/ci-integration.md`, now `$WARDEN`;
    - a `guard:` job in a research sketch, now `check:`;
    - one-column misalignments from the longer name, in `--help`, a workflow comment and the CODEOWNERS sample;
    - a log line naming `.design-warden/handoff/`, a directory that never existed;
    - six dangling `design-guard` shims in `node_modules/.bin`;
    - the npm items missing from "Needs the requester".
  - After the fixes: `pnpm typecheck` exit 0; `pnpm test` 17 files, **268 passed**; the workflows parse and are identical; 0 broken links.
  - Deferred, both older than the rename:
    - after the starter policy is copied next to an app, its relative `$schema` path points nowhere (the CLI ignores it, but editors lose completion);
    - on Windows, `pnpm --filter … build` fails with "os error 3" from a checkout path long enough to push pnpm's task-state file past 260 characters. `docs/troubleshooting.md` covers only scenario runs.
- 2026-10-11 (npm names reserved, at the requester's request):
  - `npm login --auth-type=web` with the requester approving from their phone: `npm whoami` → `evanwieland`.
  - `npm publish` of the placeholder (README and package.json, 337 B, no code). npm only offers its link-based 2FA to an interactive terminal, so it ran with a preload that sets `isTTY` and `--browser=false`; the requester approved the printed link. Result: `+ design-warden@0.0.0`.
  - `npm view design-warden`: maintainer `evanwieland`, created 2026-10-11T17:29:19Z; right after publishing the registry still showed `0.0.0-stage` ("being processed").
  - The requester created the `design-warden` organization: `https://registry.npmjs.org/-/org/design-warden/package` returns 200 `{}` (404 before).
- 2026-10-11 (pushed to GitHub; first CI run; README visuals):
  - At the requester's request: branch renamed `master` → `main`, remote `origin` = `https://github.com/EvanWieland/design-warden.git`, one commit of 294 files. Before committing: no ignored or generated files staged, and a secret-pattern scan found only the fake keys in the redaction tests. GitHub refused the first push ("push declined due to email privacy restrictions"); the commit was redone with the requester's no-reply address (set for this repository only) and pushed as `6a86900`.
  - CI run 38160917205 on `ubuntu-latest`: checkout, Node 24, `pnpm install --frozen-lockfile` and `pnpm typecheck` passed; `pnpm test` failed 1 of 268, so the later steps (browser tests, check:demo, eval, pack test, audit) were skipped. The failure: `visual-scenarios.test.ts` got `["src/design-system/tokens.css", "node_modules"]` as changed files. Cause: off Windows, `fs.symlinkSync(…, 'junction')` makes a symlink, which git treats as a file, and the workspace exclude `node_modules/` matches only directories. Reproduced locally with git: an entry named `node_modules` that is not a directory shows as `??` under `node_modules/` and disappears under `node_modules`. Fixed in `tools/harness/src/run.ts` (exclude `node_modules`). After the fix, locally: `pnpm typecheck` exit 0; `pnpm test` 17 files, **268 passed**. Not yet verified on Linux: that needs a push and a CI re-run.
  - README visuals: a hand-drawn logo and three screenshots captured from real runs (throwaway Playwright scripts in the session scratchpad, driving the built inspector on port 4402 the way `tests/e2e/inspector.spec.ts` does):
    - `docs/assets/logo.svg`: hand-drawn mark (a shield holding a check drawn as a vector path with anchor points), checked at 112, 32 and 16 px on GitHub's light and dark backgrounds;
    - `docs/assets/inspector.png` (hero): the hardcoded-color scenario, result FAIL, matching expectations;
    - `docs/assets/visual-diff.png`: token-change with visual capture, viewer on `orders/default/mobile` (0.87% of pixels, 6 regions);
    - `docs/assets/semantic-review.png`: agent-evasion with the replayed model response (accepted 1, rejected 2);
    - The hero and the diff are framed (rounded border, fade at the bottom); the AI panel keeps its own card border, with transparent corners. All RGBA at 2x, 147 to 439 KB. All README links and image paths resolve (41 files, 0 broken links).
    - The README's status line now reflects the first CI run.
  - Independent review: the fix is correct and complete. It traced `gitChangeSet` (tracked changes plus untracked files that git does not ignore), confirmed the base commit is made before the link exists and that the inspector uses the same `runScenario`, and found nothing else that is junction-specific. Its four doc and image findings are fixed: the README overstated the CI status; the diff's alt text counted a region below the crop; the AI panel image was not framed (light corners on dark backgrounds); a sliver of the card above the hero's result panel showed.
- 2026-10-11 (CI green on Ubuntu): pushed `71595b3` (the Linux fix and the README visuals) at the requester's request. CI run 38163485001 on `ubuntu-latest` passed every step:
  - `pnpm typecheck`;
  - `pnpm test`: 17 files, **268 passed**;
  - `pnpm test:e2e`: **11 passed**;
  - `pnpm check:demo`: PASS (0 blocking, 3 suppressed);
  - `pnpm eval`: All 140 / 1 / 1, 99.3% precision and recall, with the same two documented mismatches as on Windows;
  - `pnpm test:pack`: 1 passed;
  - `pnpm audit --audit-level high`: no known vulnerabilities.
  - The README status line now says CI passes on Ubuntu, the pull-request workflow has not run on GitHub yet, and macOS is untested.
- 2026-10-11 (C1: the pull-request workflow on GitHub). Backlog C1–C13 added above. Decisions taken with the requester: skip the live-model evaluation; publish publicly on npm with the repository kept private.
  - Test PR #1 (branch `try/pr-workflow`, commit `b0c7b92`: the `hardcoded-color` scenario plus the `token-change` edits applied to `apps/demo`), opened through the REST API.
  - Design Warden run 38166503036:
    - `check`: exit 1 ("FAIL - 1 blocking, 1 need review"); check-run annotations: failure on `apps/demo/src/pages/OverviewPage.css:3` (color/semantic-tokens, with the suggested token) and warning on `apps/demo/src/design-system/tokens.css:22` (governance/shared-change-review: 7 tokens, 10 usages);
    - `visual`: in the pinned container, "Captured 16/16 states" for base and head, and a visual review request per changed screen (overview 21.66% of pixels, because the scenario adds a paragraph; the others 0.30–1.02%);
    - `semantic`: skipped, because `check` failed (and there is no key).
  - The CI run on the same PR failed 5 tests, as it must: the tests need a pristine demo, and the PR edited it ("edit to src/design-system/tokens.css expected exactly one match, found 0. Has the demo changed?").
  - PR #1 closed unmerged, its branch deleted. Open question 11 answered; ci-integration.md's "What was verified" and the README status updated.
  - GitHub announced that `ubuntu-latest` moves to Ubuntu 26.04 from 2026-10-19, so every runner is pinned to `ubuntu-24.04`. New test in `tests/repo.test.ts`: RED (8 floating labels: 7 in the workflows, 1 in ci-integration.md), then GREEN (8/8).
- 2026-10-11 (C2: pull-request comments).
  - `design-warden comment <report.json>…` (new `reporters/comment.ts`): checks each file is a report (`reportVersion: 1`, arrays and objects where the renderer reads them; exit 2 naming the file otherwise), then renders all reports as one comment that starts with `<!-- design-warden -->`. If the comment exceeds GitHub's limit, it is re-rendered with fewer rows per report (50, 20, 10, 5, 0).
  - `renderMarkdown` now escapes or type-checks every field it prints (`ruleId` only in a code span when it is a plain rule name; outcome and engine names through lookups or `md()`; counts must be numbers). A forged report is the threat: the visual job builds pull-request code.
  - Tests first: 4 new in `policy-and-reports.test.ts` (forged report, combined comment, invalid files, size limit), all RED. The forged-report assertion first matched escaped text (`\<img`, which markdown renders literally), so it was rewritten to look for unescaped `<`, `](` and `://`; with the hardening stashed it still fails, so it catches the bug.
  - Workflow: a new `comment` job (needs check, visual and semantic; `!cancelled()`; skipped for forks and Dependabot) with `pull-requests: write`. It checks out the base SHA, runs `pnpm install --frozen-lockfile --ignore-scripts`, downloads the report artifacts (`actions/download-artifact` v8.0.2, pinned at `9000827c…`, inputs checked at that commit) and renders them. It then updates the comment that `github-actions[bot]` wrote with the marker, or posts a new one. The step script ran locally against real reports with a stub `gh`: POST with no comment yet, PATCH 4242 when one exists.
  - On GitHub, PR #2 (closed unmerged): run 38167653668 posted one comment, but without a visual section. Cause: in the container job, `${{ runner.temp }}` is the host's path, so upload-artifact chose `/` as the root, stored `__w/_temp/visual-report.json`, and left the diff images out. That was true since C1, which had checked only that the job succeeded. Fixed by writing to `.design-warden/ci` (workspace-relative). New repo test: RED (it matched my own comment quoting the expression; reworded), then GREEN. Re-run 38168019692: the same comment (id 6112779551) was updated in place, now with the visual section for the 8 changed screens; the visual artifact is 2,727,383 bytes, up from 3,781.
  - Docs: ci-integration.md (the job table and "Pull-request comment"), security.md (token permissions, P6), README (the CI table and status), CHANGELOG.
- 2026-10-11 (C3: CSS-in-JS object styles).
  - `style-values.ts`: style objects now have a kind (inline, CSS-in-JS, `sx`). Nested objects (selectors, media queries, keyframe steps) recurse. The arguments of style calls (`isStyleTag` callees: `css`, `keyframes`, `styled.x`, `styled(X)`, `styled.x.attrs(…)`) are read, through same-file constants, arrays and what functions return. The `css` and `sx` props are read too. `sx` keeps only literal strings that are not theme paths (`/^[a-z][\w-]*(\.[\w-]+)+$/i`) and maps MUI shorthands (`p`, `px`, `mt`, `bgcolor`, …) to CSS properties.
  - Tests first: 2 new in `checks.test.ts` (calls, the css prop and nesting; `sx`), both RED. The first stayed red after the change because of a dangling `else` in `objectsOf`, which attached the function branch to the array loop's inner `if`. Braces fixed it.
  - Benchmark: new `CssInJsObjects.tsx`, 10 labels. Nine are for object styles and `sx`, all hits. The run also reported `components/reuse-existing` on a component I had named `Stack` (built from `<Box sx>`). `Stack` is a registered design-system component, so by the rule's definition this is a true positive, and it is labelled as one. `pnpm eval`: 22 files, 151 expected, **150 / 1 / 1** (99.3% / 99.3%), the same two documented mismatches; insufficient evidence 15.2%. The pinned baseline is now tp 150. evaluation.md, README (151 labels, status table), rules.md (new "CSS-in-JS object styles" section), architecture.md and CHANGELOG updated.
  - The full suite failed once with `read ECONNRESET` in `app.test.ts` ("serves a real run artifact"); 3 isolated runs passed. Cause: the run blocks the test process's event loop (it hosts the inspector server too) for more than Node's 5 s keep-alive timeout. When the loop resumes, the client's poll reuses the socket in the same timers phase that closes it. The real UI polls the same way. Fix: `keepAliveTimeout` 65 s and `headersTimeout` 66 s on the inspector server; test RED, then GREEN.
  - Verification: `pnpm typecheck` exit 0; `pnpm test` **277 passed**; `pnpm scenario run all` 11/11 ok.
- 2026-10-11 (C4: Tailwind default-palette color classes).
  - `tailwind.ts` `themeColor()`: after variants, `!` and an opacity modifier are stripped, a color utility (`bg`, `text`, `border[-side]`, `divide`, `outline`, `ring[-offset]`, `fill`, `stroke`, `decoration`, `accent`, `caret`, `placeholder`, `from`/`via`/`to`, the shadows) that names the default palette (22 hues by 50–950, plus `black` and `white`) becomes `var(--color-<name>)`. The palette is inside the regular expression, so `text-shadow-red-500` backtracks to `text-shadow`. `classValues` emits these with `theme` set to the palette name.
  - `token-usage` names the class ("Class `bg-red-500` uses `--color-red-500`, which is not a defined design token."). When the palette token is internal and a semantic token has the same value, the suggestion names the replacement class with its variants and opacity ("Use `hover:text-danger/80` (var(--color-danger)), which has the same value."). Messages for other references are unchanged.
  - Tests first: 2 new in `checks.test.ts` (undefined palette tokens, with sizes and keywords as negatives; an internal palette token with a same-value suggestion), both RED, then GREEN. The intended behaviour changed for one existing test, which listed `text-red-500` as an always-allowed theme class: it now uses `text-danger`, a project color name, which stays allowed.
  - Benchmark: `Tailwind.tsx:13` `text-slate-700` was a tricky negative and became a false positive. The demo has no `--color-slate-700`, so under the new contract it is a token reference that bypasses the design system: relabelled as expected, with the comment updated (the theme-class negative is now `p-4`). Two new lines add 4 labels (`text-gray-500`, `hover:bg-blue-600/90`, `text-white`, `ring-offset-indigo-500`), with `border-2 text-sm bg-transparent shadow-lg` as negatives. `pnpm eval`: 156 expected, **155 / 1 / 1** (99.4% / 99.4%), the same two documented mismatches; insufficient evidence 14.7%; the pinned baseline is now tp 155. Docs: rules.md (the Tailwind section, `no-hardcoded-color`, `token-usage`), evaluation.md, README, CHANGELOG.
  - Verification: `pnpm typecheck` exit 0; `pnpm test` **279 passed**; `pnpm check:demo` PASS, 17/17 examples; `pnpm scenario run all` 11/11.
