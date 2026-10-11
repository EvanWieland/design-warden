# CI integration

Design Warden is a command with documented exit codes. CI integration means running it with the right inputs, publishing its outputs, and keeping the trust boundaries intact.

## Exit codes

| Code | Meaning | Typical CI handling |
|---|---|---|
| `0` | Pass, or **review requested** | Job succeeds. Review requests appear as warnings and in the job summary |
| `1` | A blocking finding (a confirmed violation of a `block` rule), or a review request with `--fail-on review` | Job fails; make it a required check |
| `2` | Usage or setup error: invalid policy, bad arguments, an unknown base ref, Chromium not installed | Job fails; fix the configuration |
| `3` | An engine failed and its failure mode is `fail-closed` | Job fails; the result is unknown |

**Blocking failure vs. review request.**
- A blocking failure means a deterministic check confirmed a violation of a rule whose enforcement is `block`. The pull request should not merge as is.
- A review request means a human should look: a preferred-pattern deviation, a novel pattern, insufficient evidence, a visual change, a shared-token change, a policy change, a failed optional engine, or any AI finding.

GitHub jobs can only pass or fail (required checks treat "neutral" as passing). So review requests exit 0 and are made visible through warnings, the summary, and the `outcome` step output. To enforce human review:
- use CODEOWNERS on the design-system paths and the policy, or
- run with `--fail-on review` and let maintainers re-run after approval, for example gated by a label in your own workflow.

## GitHub output (`--format github`)

Needs no permissions beyond `contents: read`.

- **Annotations:** fail → `::error`, review → `::warning`, info → `::notice`.
  - Ranked by outcome and capped at 10 per level, because GitHub shows at most 10 per level per step. A final notice reports how many were omitted.
  - De-duplicated by finding fingerprint.
  - Paths are converted to be relative to `GITHUB_WORKSPACE` and checked against the file on disk. A location that cannot be validated is dropped rather than guessed.
- **Job summary:** markdown appended to `$GITHUB_STEP_SUMMARY` (capped at 900 KB). Finding text is escaped, so link and image syntax from repository or model text cannot render.
- **Log:** the human-readable report is printed between `::stop-commands::<random token>` markers, so a `::command::` inside repository or model text is not interpreted by the runner. Annotation fields are escaped and kept to one line.
- **Step outputs** in `$GITHUB_OUTPUT`: `outcome`, `exit-code`, `blocking`, `review`.
- **Report:** `--report <file>` writes the full JSON report. Upload it as an artifact and open it in the inspector (**Open a report file**).

## Code scanning (`--format sarif`)

`--format sarif` prints SARIF 2.1.0. GitHub code scanning shows it as alerts in the Security tab and on pull requests. Other SARIF viewers read it too.

- **Contents:** the findings that count toward the outcome; suppressed and pre-existing findings are left out.
  - Levels follow the outcome: fail → `error`, review → `warning`, info → `note`.
  - Each rule carries its title, rationale, remediation and guidance. Each result carries its message and suggestion and the finding's outcome, verdict, origin and confidence.
  - Everything is plain text: no `markdown` fields, because messages contain repository and model text.
- **Fingerprints:** each result has `partialFingerprints["designWarden/v1"]`, the finding id. It hashes rule, file and evidence text, so an alert survives edits that only shift lines.
- **Paths** are relative to the directory the check ran in. Run it from the repository root: GitHub expects repository-relative paths.
- **Without a location** (visual changes, some model findings), a result is in the file, but GitHub does not display it. The job summary and the JSON report still have it.
- **Incomplete runs write nothing.** If any engine failed or was incomplete, whatever its failure mode, no SARIF is written and the reason goes to stderr; a usage error (exit 2) writes none either. Code scanning would read an incomplete result as fixed alerts. In the job below, the redirect then leaves an empty file, which is not valid SARIF; expect the upload step to fail on it rather than clear alerts (not run on GitHub).
- **Requirements:** the upload needs `security-events: write`, and in private repositories also `actions: read`. Code scanning is free for public repositories. Private and internal repositories need GitHub Code Security (formerly part of GitHub Advanced Security); without it the upload is refused. Pull requests from forks get a read-only token, so the upload cannot work there: the job below skips them, and the `check` job still gates.
- **Scope:** with `--base`, only changed files are analysed, while the base branch's analysis covered everything. How GitHub presents alerts that are missing from a partial analysis has not been tested here. The job below scans the whole project, which avoids the question; the `check` job still gates on the change.

A job to add next to `check` in the example workflow (same checkout and trusted-tool steps):

```yaml
  code-scanning:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    # Fork pull requests get a read-only token, which cannot upload.
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    permissions:
      contents: read
      security-events: write
      actions: read # needed in private repositories
    steps:
      # … checkout and "Install the trusted tool", as in the check job …
      - name: Design Warden as SARIF
        # Exit 1 means blocking findings: expected here, because the check job gates.
        # Exit 2 or 3 fails the step, so a broken run is never uploaded.
        run: $WARDEN check --policy "$PROJECT_DIR/design-warden.policy.json" --policy-ref "$BASE" --format sarif > design-warden.sarif || [ $? -eq 1 ]
      - uses: github/codeql-action/upload-sarif@24c54180a607b1449ed407dd24f251e4e9147c8d # v4.38.3
        with:
          sarif_file: design-warden.sarif
          category: design-warden
```

Give every upload of the same commit its own `category`, or the second replaces the first. The output was validated against the official SARIF 2.1.0 schema (2026-10-10, scenario outputs). The upload to GitHub has not been run from this environment.

## The example workflow

[`examples/github-actions/design-warden.yml`](../examples/github-actions/design-warden.yml) is identical to `.github/workflows/design-warden.yml` in this repository (a test keeps them identical). It checks the demo app. To adopt it, change the four variables at the top. It assumes Design Warden lives in the same repository, as here or in a fork, and runs from source on Node 24. In any other repository, replace each job's "Install the trusted tool" step with a pinned npm version: set `WARDEN` to `npx --yes design-warden@0.2.0` (for example `echo "WARDEN=npx --yes design-warden@0.2.0" >> "$GITHUB_ENV"`). The pinned version plays the role of the base-branch worktree: a pull request cannot change it. The npm package's README has a minimal one-job workflow.

Every job first installs a **trusted copy of the tool**: `git worktree add` of the base branch into `$RUNNER_TEMP/tool`, outside the checkout, then `pnpm install --frozen-lockfile --ignore-scripts`. The pull request is analyzed, but it does not supply the analyzer.

| Job | Purpose | Permissions and secrets | Blocks? |
|---|---|---|---|
| `check` | Deterministic policy check against `origin/<base>` with `--policy-ref` | `contents: read`, no secrets | Yes (exit 1) |
| `visual` | Builds base (git worktree) and head in the pinned Playwright container (`mcr.microsoft.com/playwright:v1.64.0-noble`, pinned by digest), captures both, compares with `--only visual` | `contents: read`, no secrets | No: review only |
| `semantic` | Optional model review with `--only semantic`; runs after `check` passes | The only secret, visible to one step | No: review only |
| `comment` | Keeps one comment on the pull request up to date with the other jobs' reports | `contents: read` and `pull-requests: write`, no secrets; checks out the base branch only | No |

**Pull-request comment.** After the other jobs, `comment` renders their JSON reports with `design-warden comment` and posts them as one comment. Later runs update that comment: the job finds the comment its own bot wrote, by the `<!-- design-warden -->` marker on its first line. It is the only job that can write, so it checks out the base branch, never pull-request code, and treats the reports as data. The visual job built pull-request code and could forge anything it uploads, so the comment job downloads each report by the artifact id its job outputs (never by name) and titles each section by that job (`design-warden comment check=… visual=… semantic=…`). The renderer escapes or type-checks every field, so a forged report cannot add links, images, HTML or `@` mentions. A report that cannot be read becomes a placeholder section instead of leaving the previous comment in place, and the footer names the commit. Rendering runs without the token; posting runs only `gh`. Long reports get fewer rows per section, to fit GitHub's 65,536-character limit. Fork and Dependabot pull requests get a read-only token, so the job is skipped for them; the job summaries still show everything. Outside GitHub Actions, `design-warden comment report.json…` prints the same markdown for any CI system that can post it, such as a GitLab merge-request note.

If the policy has an `accessibility` rule, the `visual` job's captures also run axe-core, and its comparison reports new accessibility violations for review; the workflow needs no change. Results are compared only between captures made in the same environment with the same axe-core version and tags. Otherwise the comparison reports that, instead of reporting old violations as new.

`--only visual|semantic` makes a job report, and decide its exit code on, that engine's findings only. Without it, the review jobs would repeat the source findings and fail whenever `check` fails. The source engine still runs in those jobs, because the model review takes its findings as context.

`actions/checkout` uses `fetch-depth: 0`, because the merge base needs history.

**Pinned actions and image.** Every `uses:` names a full commit SHA, with the version in a comment, and `tests/repo.test.ts` fails on an unpinned one. On 2026-10-10 they were pinned to `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0 and `actions/upload-artifact` v7.0.2. They were moved up from v5, v5 and v4: setup-node v5 caches automatically when `package.json` has a `packageManager` field, which here names pnpm, before corepack has installed it; from v6 on, it only does this for npm. To update a pin, look the tag up with `git ls-remote https://github.com/actions/<name> refs/tags/<tag> "refs/tags/<tag>^{}"`. For an annotated tag, use the `^{}` (peeled) commit, not the tag object. The Playwright container is pinned by its multi-platform index digest (looked up on 2026-10-11 from `https://mcr.microsoft.com/v2/playwright/manifests/v1.64.0-noble`, header `Docker-Content-Digest`), and the same test keeps its tag equal to the `playwright` npm version. Runner images are pinned as well (`ubuntu-24.04`): a `-latest` label moves to a new OS on GitHub's schedule (`ubuntu-latest` becomes Ubuntu 26.04 from 2026-10-19), and the test fails on one.

**What was verified (2026-10-10).**
- The workflow files parse as valid YAML.
- Every command of all three jobs was executed locally on Windows, in a scratch repository with `main`, `origin/main` and a feature branch carrying the `hardcoded-color` scenario:
  - the worktree install with `--ignore-scripts`;
  - `check`: exit 1, one `::error` annotation, step summary and outputs;
  - both builds, `capture --serve` (16/16 states each), and the comparison with `--only visual`: exit 0, only the visual review finding;
  - the semantic step with the replay provider instead of `anthropic`, plus `--only semantic`: exit 0, only the model finding.
- **On GitHub (2026-10-11),** a test pull request ([#1](https://github.com/EvanWieland/design-warden/pull/1), private repository, closed unmerged) carried the `hardcoded-color` and `token-change` scenarios. Run 38166503036:
  - `check`: exit 1, a failure annotation on `apps/demo/src/pages/OverviewPage.css:3` with the suggested token, and a warning on `tokens.css:22` for the shared token change;
  - `visual`: in the container, both builds captured 16/16 states, and every changed screen was reported for review;
  - `semantic`: skipped, as designed, because `check` failed (it also needs the `ANTHROPIC_API_KEY` secret). Its live path has not run on GitHub.

## Committed baselines

The example workflow builds and captures the base revision in every run. Instead, a team can commit a capture directory as the baseline and compare each run's captures with it. That skips the second build, and gives a stable reference for spotting drift on the main branch.

```bash
# Build the app, then create or update the baseline, in the same environment as CI (see below):
pnpm --filter @design-warden/demo build
pnpm design-warden capture --policy apps/demo/design-warden.policy.json --serve apps/demo/dist --out apps/demo/design-warden-baseline
# Later runs build and capture the head, then compare it with the baseline:
pnpm --filter @design-warden/demo build
pnpm design-warden capture --policy apps/demo/design-warden.policy.json --serve apps/demo/dist --out .design-warden/head
pnpm design-warden check --policy apps/demo/design-warden.policy.json --visual-base apps/demo/design-warden-baseline --visual-head .design-warden/head --only visual
```

`capture --serve` stops with exit 2 before starting a browser when the directory has no `index.html`, for example when the build step was skipped.

- **The environment must match.** The manifest records a fingerprint: Playwright version, browser build, headless mode, platform and architecture, device scale factor. The comparison refuses a baseline whose fingerprint differs from the head's, because fonts and anti-aliasing differ between machines. The visual engine is then reported as failed (with this reason), and its failure policy decides the outcome (`review` by default). So capture baselines where CI captures, for example inside the pinned `mcr.microsoft.com/playwright:v1.64.0-noble` container (pinned by digest, so the image cannot change under the tag), and re-capture them when you upgrade Playwright. Accessibility results also need the same axe-core version and tags: after an upgrade, the comparison reports that instead of new violations.
- **Read the baseline from the base branch.** A pull request can edit its own copy of the baseline and hide its visual changes. In the `visual` job, pass the baseline from the base-branch worktree (`--visual-base "$RUNNER_TEMP/base/<project>/design-warden-baseline"`), and protect the directory with CODEOWNERS like the policy.
- **Updating the baseline is a reviewed change:** re-capture, commit, and let owners review the new screenshots in the pull request.
- PNGs must be committed as binary (`*.png binary` in `.gitattributes`, as in this repository). Each state is one PNG, typically 50–200 KB; Git LFS is optional.

What was verified: `packages/cli/test/policy-and-reports.test.ts` captures a baseline into the project, captures a changed page, compares them (one review finding), and checks that a baseline with another fingerprint is refused with this guidance, and that a `--serve` directory without `index.html` exits 2. The commands above were run on Windows on 2026-10-11 (see the progress log in [PLAN.md](PLAN.md)). Capturing in the container has not been run from this environment (no Docker).

## Trust model in CI

- **Policy from the base branch.** `--policy-ref origin/<base>` loads the policy, and the guidance given to the model, from the base branch, so a pull request cannot weaken the rules that judge it. The policy edit itself is still reported (`policy/changed`), and weakened or removed blocking rules are called out.
- **Workflow files are part of the boundary.** On `pull_request`, GitHub runs the pull request's own copy of the workflow. Protect `.github/workflows/**`, the policy and the design-system paths with CODEOWNERS and a ruleset that requires owner review. Fork pull requests get no secrets and a read-only token by default.
- **The tool comes from the base branch.** A pull request that edits Design Warden itself (in this repository, `packages/**`) is judged by the base branch's version. Protect the tool's source like the workflow.
- **The check and semantic jobs treat the pull request as data.** They read and diff it; they never install or execute it. Only the trusted copy is installed, with `--ignore-scripts`. In the semantic job the API key is set only on the step that runs the review. Without the secret (forks, Dependabot), the job prints a skip message.
- **The visual job executes pull-request code**, because it has to build the app. Build scripts could tamper with anything in that job, including the trusted copy's files and the captures. So the job holds no secrets, has a read-only token, and never blocks: its report is a review aid, not a gate.
- **Prefer `pull_request` to `pull_request_target`.** Running pull-request code with secrets is the classic "pwn request". GitHub Security Lab's guidance applies.
- **A ruleset to start from** on the default branch: require a pull request, code-owner review, and the `Design policy (deterministic, blocking)` check, and block force pushes and deletion. With a [CODEOWNERS](../.github/CODEOWNERS) file like this repository's, owner review then covers the workflows, the policies, the design system and its guidance, and the tool. GitHub offers rulesets and branch protection for private repositories only on paid plans: this repository is private on the free plan, so its CODEOWNERS file documents ownership but is not enforced (the API answers "Upgrade to GitHub Pro or make this repository public to enable this feature", checked 2026-10-11).

## Other CI systems

The JSON report contains everything other formats need. Any CI can run a pinned npm version from your repository's root, use the exit code, and keep the JSON as an artifact. Pinning the version keeps a change from altering the tool that judges it:

```bash
npx --yes design-warden@0.2.0 check --policy design-warden.policy.json --base "origin/$TARGET_BRANCH" --policy-ref "origin/$TARGET_BRANCH" --report design-warden.json
```

SARIF (above) works with any SARIF viewer.

### GitLab Code Quality (`--format gitlab`)

`--format gitlab` prints a Code Quality report: a JSON array of issues with the fields GitLab reads (`description`, `check_name`, `fingerprint`, `severity`, `location.path`, `location.lines.begin`).

- **Contents:** the same findings as SARIF, the ones that count toward the outcome. GitLab needs a file and a line for every issue, so findings without a location are left out.
- **Severity** follows the outcome: fail → `major`, review → `minor`, info → `info`. `check_name` is the rule id, `fingerprint` is the finding id, and the description includes the suggestion.
- **Paths** are relative to the directory the check ran in, so run it from the repository root.
- **Incomplete runs write nothing**, as for SARIF: if any engine failed or was incomplete, or after a usage error, there is no report.
- **Scope:** the merge-request widget compares the report with the target branch's latest report. So both pipelines should scan the whole project (no `--base`); with `--base`, issues in untouched files would be missing from the merge request's report. Gate merges with a separate `--base` job, as the GitHub `check` job does.

A job for `.gitlab-ci.yml`. Like the GitHub workflow, it runs the tool and loads the policy from the target branch:

```yaml
design-warden-code-quality:
  image: node:24
  timeout: 10 minutes
  variables:
    GIT_DEPTH: 0                      # the target branch must be fetchable
    PROJECT_DIR: apps/demo            # directory with design-warden.policy.json
  script:
    - TARGET="${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-$CI_DEFAULT_BRANCH}"
    - git fetch origin "$TARGET"
    - git worktree add --detach /tmp/tool "origin/$TARGET"
    - (cd /tmp/tool && corepack enable && pnpm install --frozen-lockfile --ignore-scripts)
    # Exit 1 (blocking findings) still produces the report; exit 2 or 3 fails the job and uploads nothing.
    - node /tmp/tool/packages/cli/src/bin.ts check --policy "$PROJECT_DIR/design-warden.policy.json" --policy-ref "origin/$TARGET" --format gitlab > gl-code-quality-report.json || [ $? -eq 1 ]
  artifacts:
    reports:
      codequality: gl-code-quality-report.json
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

The two worktree lines install this repository's copy of the tool, as in this repository's own pipelines. Elsewhere, replace them, and `node /tmp/tool/packages/cli/src/bin.ts`, with a pinned `npx --yes design-warden@0.2.0`.

Where GitLab shows the results (merge-request widget, diff, pipeline tab) depends on your GitLab tier; see GitLab's Code Quality documentation. This job has **not** been run on GitLab from this environment.
