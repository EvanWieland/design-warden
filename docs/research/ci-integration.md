# CI integration: annotations, checks, SARIF, PR security

Last verified: 2026-10-10

## Questions

(1) Annotations and job summary, (2) SARIF upload, (3) check runs and "review requested", (4) PR-workflow security, (5) PR diff, (6) Playwright in CI, (7) GitLab Code Quality.

## Findings

**1. Annotations and job summary**
- Syntax: `::error file=F,line=L,endLine=E,col=C,endColumn=K,title=T::MSG` (also `warning`/`notice`); all properties are optional. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
- Escaping is undocumented. `@actions/core` escapes the message as `%`→`%25`, CR→`%0D`, LF→`%0A`, and in properties also `:`→`%3A`, `,`→`%2C`. [Verified](https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts)
- The runner makes `file` relative to `github.workspace` and translates container paths. Paths outside the workspace pass through unchanged. [Verified](https://github.com/actions/runner/blob/main/src/Runner.Worker/ActionCommandManager.cs) The `file` property gets dropped when the file is missing or outside the workflow repo, so the annotation isn't attached to a file. [Verified](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md) So emit repo-relative POSIX paths.
- Caps: 10 error + 10 warning + 10 notice per step, and 50 per job. These are documented only in actions/toolkit. [Verified](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md) Anything over the cap is hidden without notice. [community](https://github.com/orgs/community/discussions/68471)
- Check annotations show in the PR's "Files changed" tab. [Verified](https://developer.github.com/changes/2019-09-06-more-check-annotations-shown-in-files-changed-tab) Workflow-command annotations need no token permissions, so they work on fork PRs. [Inferred]
- Untrusted stdout (build logs, LLM text) could spoof `::` commands. [Inferred] `::stop-commands::<random>` suspends command processing. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
- `$GITHUB_STEP_SUMMARY` takes Markdown: 1 MiB per step, max 20 step summaries per job, shown on the run page, secrets masked. `$GITHUB_OUTPUT` takes `name=value` lines. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)

**2. SARIF**
- `github/codeql-action/upload-sarif@v4` is current (v4.38.3, released 2026-10-08). [Verified](https://github.com/github/codeql-action/releases) v3 is deprecated in Dec 2026. [Verified](https://github.blog/changelog/2025-10-28-upcoming-deprecation-of-codeql-action-v3/)
- Needs `security-events: write`, plus `contents: read` and `actions: read` on private repos. [Verified](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github) Uploads are "always" allowed on `pull_request` runs [Verified](https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/scan-code-for-vulnerabilities/troubleshooting/troubleshooting-analysis-errors/resource-not-accessible), so fork PRs probably work. [Inferred]
- Free on public repos. Private repos need GitHub Code Security on a Team or Enterprise plan. [Verified](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security) Launch price was $30 per active committer per month. [Verified](https://github.blog/changelog/2025-03-04-introducing-github-secret-protection-and-github-code-security/) Current price: [Unresolved]
- Limits: 10 MB gzipped, 20 runs per file, and 25k results per run (only 5k shown). [Verified](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)
- The docs mark as required: `$schema`, `version:"2.1.0"`, `tool.driver.name`, and `rules[]` (`id` plus `.text` for `shortDescription`, `fullDescription` and `help`). For results: `message.text`, `locations[].physicalLocation` (repo-relative `artifactLocation.uri`, `region`) and `partialFingerprints`, which `upload-sarif` computes if missing. The docs' own "minimum" example leaves several of these out. [Verified](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)
- `category` separates analyses. Two runs with the same tool and category in one file have been rejected since 2025-07-22. [Verified](https://github.blog/changelog/2025-07-21-code-scanning-will-stop-combining-multiple-sarif-runs-uploaded-in-the-same-sarif-file/)
- On PRs there is a "Code scanning results" check per tool, and new alerts on changed lines become annotations. By default the check fails on `error`/`high`/`critical`; this is configurable. [Verified](https://docs.github.com/en/code-security/code-scanning/managing-code-scanning-alerts/triaging-code-scanning-alerts-in-pull-requests)
- The base branch must be analyzed too (run on `push` as well), otherwise the check shows "Missing analysis" (GHES 3.2 docs). [Verified](https://docs.github.com/en/enterprise-server@3.2/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/setting-up-code-scanning-for-a-repository)
- GitHub Code Quality has no third-party ingestion on its roadmap (PM, Nov 2025). [Verified](https://github.com/orgs/community/discussions/177488)

**3. Check runs and statuses**
- Conclusions: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`. Only GitHub Apps can create check runs, with at most 50 annotations per request. [Verified](https://docs.github.com/en/rest/checks/runs)
- `GITHUB_TOKEN` is an App token [Verified](https://docs.github.com/en/actions/concepts/security/github_token). With `checks: write` it can create runs on same-repo PRs only. [Inferred] Such runs can't target a check suite and may show up under another workflow (GitHub Support, 2020). [Verified](https://github.com/orgs/community/discussions/24616)
- A job's own check is `success` (exit 0) or `failure`; there is no neutral. [Verified](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/set-exit-codes)
- Required checks treat `neutral` as passing, so a neutral check can't block a merge. [Verified](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- Alternatives:
  - CODEOWNERS with required code-owner review (path-based, static). [Verified](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  - Environment reviewers, which require Enterprise on private repos. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
  - Labels or comments, which need a write token. [Inferred]

**4. Security**
- `pull_request` from a fork gets a read-only token and no secrets. `GITHUB_SHA` is the merge commit. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) So the PR controls the workflow and config, and same-repo PRs also get secrets. [Inferred]
- `pull_request_target` gets a read/write token even for fork PRs. [Verified](https://docs.github.com/en/actions/reference/github_token-reference) Since 2025-12-08 it always runs the default branch's workflow. [Verified](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/)
- `workflow_run` gets secrets and a write token. The docs pass the PR number through an artifact. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- `actions/checkout` v7 blocks fork-PR checkout under `pull_request_target`/`workflow_run` unless you set `allow-unsafe-pr-checkout`. `persist-credentials` still defaults to true. [Verified](https://github.com/actions/checkout)
- Since 2023-02-02, new enterprises, standalone orgs and personal repos default to a read-only token. Others inherit their parent's setting, and existing settings are unchanged. [Verified](https://github.blog/changelog/2023-02-02-github-actions-updating-the-default-github_token-permissions-to-read-only/) Declaring any permission sets all the others to `none`. [Verified](https://docs.github.com/en/actions/reference/github_token-reference)
- GitHub Security Lab: never build PR code with privileges, because `npm install` runs package scripts. Artifacts from untrusted runs are untrusted, and label gating is racy. [Verified](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
- GitHub's hardening guide: pin actions to full SHAs, and pass untrusted context through `env`. [Verified](https://docs.github.com/en/actions/reference/security/secure-use)
- Dependabot PRs get Dependabot secrets, not Actions secrets. [Verified](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions)
- Org rulesets can require a workflow from another repo, the only setup where a PR can't edit its own gate. [Verified](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) Which plans include it: [Unresolved]

**5. PR diff**
- Checkout uses the merge commit with `fetch-depth: 1` by default. [Verified](https://github.com/actions/checkout) The PR UI shows a three-dot diff. [Verified](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests)
- With `fetch-depth: 2`, `git diff HEAD^1 HEAD` is the PR's net change. Diffing against `base.sha` needs history down to the merge-base; depth 1 has none. [Inferred]
- REST "List PR files" caps at 3,000 files. [Verified](https://docs.github.com/en/rest/pulls/pulls)
- `pull_request` workflows skip PRs that have merge conflicts. [Verified](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

**6. Playwright**
- Install with `npx playwright install --with-deps chromium`. `--only-shell` installs the headless shell only; the full `chromium` channel is described as "more authentic". [Verified](https://playwright.dev/docs/browsers)
- Use `mcr.microsoft.com/playwright:v1.64.0-noble`, pinned to the npm version. The CI example runs it as `--user 1001`. Caching browsers isn't recommended. [Verified](https://playwright.dev/docs/ci), [Verified](https://playwright.dev/docs/docker) The image includes git and Node 24. [Verified](https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble)
- Rendering varies by OS, hardware and headless mode, so make and compare screenshots in one environment. [Verified](https://playwright.dev/docs/test-snapshots)

**7. GitLab Code Quality**
- A JSON array of `{description, check_name, fingerprint, severity: info|minor|major|critical|blocker, location: {path (repo-relative), lines: {begin}}}` via `artifacts:reports:codequality`. Inline diff annotations are Ultimate-only. [Verified](https://docs.gitlab.com/ci/testing/code_quality/)

## Implications for Design Warden

1. **Exit codes** (ESLint convention [Verified](https://eslint.org/docs/latest/use/command-line-interface)): `0` pass (including review requested), `1` blocking, `2` config or internal error. Add an optional `--fail-on=review`. Skip "neutral": workflows can't emit it, and it can't block a merge anyway.
2. **Build order**:
   - Terminal and JSON.
   - `--format github`, on automatically when `GITHUB_ACTIONS=true`: annotations sorted by severity (at most 10 per level, overflow count in the summary), a summary kept under 1 MiB, and `status=pass|review|fail` in `$GITHUB_OUTPUT`. About 50 lines, no dependencies.
   - GitLab Code Quality.
   - SARIF only as an opt-in: it lands in the Security tab, is paid on private repos, and needs default-branch runs.
   - No Checks API, comments or labels in v1.
3. **Review requested** = warnings + a summary section + the output flag. For a hard gate, use CODEOWNERS or `--fail-on=review` waived by a maintainer label.
4. **Security**:
   - `pull_request` only, with `contents: read` and `persist-credentials: false`.
   - The policy is data, never executable config, read via `git show HEAD^1:<file>`. That only helps if the workflows and policy are CODEOWNERS-protected or ruleset-required.
   - Escape all output, and wrap child-process output in `stop-commands`.
5. **LLM**:
   - A separate job with `permissions: {}` that only reads artifacts. A missing key (forks, Dependabot) means skip with a notice.
   - Same-repo PR authors can still edit that job; use `workflow_run` if that matters.
   - Findings can request review but never block, because of prompt injection.
6. **Screenshots**: pinned container, non-root, Chromium. Render base and head in the same job.

```yaml
on: pull_request
permissions: { contents: read }
jobs:
  check:
    runs-on: ubuntu-latest
    container: { image: mcr.microsoft.com/playwright:v1.64.0-noble, options: --user 1001 }
    steps:
      - uses: actions/checkout@<sha> # v7
        with: { fetch-depth: 2, persist-credentials: false }
      - run: git show HEAD^1:.design-warden.json > "$RUNNER_TEMP/policy.json"
      - run: npm ci && npx design-warden check --base HEAD^1 --policy "$RUNNER_TEMP/policy.json" --json dw.json
      - uses: actions/upload-artifact@<sha>
        if: ${{ !cancelled() }}
        with: { name: dw, path: dw.json }
  llm: # no PR code runs here
    needs: check
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - uses: actions/download-artifact@<sha>
        with: { name: dw }
      - run: npx design-warden@<pinned> llm-review dw.json
        env: { LLM_API_KEY: "${{ secrets.LLM_API_KEY }}" }
```

## Open questions

- Confirm the annotation caps empirically.
- What does Code Security cost now?
- Which plans include ruleset-required workflows?
- Should the LLM run on fork PRs at all? That would need `workflow_run`.

## Sources

- [Workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands): annotation and summary syntax.
- [Toolkit escaping](https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts) and [annotation caps](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md).
- [SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning): fields and limits.
- [Uploading SARIF](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github) and [codeql-action releases](https://github.com/github/codeql-action/releases): permissions and the v4 release.
- [Check runs API](https://docs.github.com/en/rest/checks/runs) and [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): conclusions and what counts as passing.
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [GITHUB_TOKEN reference](https://docs.github.com/en/actions/reference/github_token-reference): token and secret behavior on PRs.
- [pull_request_target change](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/): the workflow now always comes from the default branch.
- [actions/checkout README](https://github.com/actions/checkout): v7 fork guard and fetch-depth.
- [Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/): GitHub Security Lab hardening guidance.
- [Playwright CI](https://playwright.dev/docs/ci): install, image and caching.
- [GitLab Code Quality](https://docs.gitlab.com/ci/testing/code_quality/): report format.
