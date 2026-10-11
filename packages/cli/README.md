# design-warden

Design Warden checks frontend pull requests against a design-system policy. It is built for teams whose UI is increasingly written by AI coding agents, which can follow extensive design guidance and still drift: plausible colors that bypass tokens, raw controls, missing states, hand-made copies of existing components.

- **Deterministic checks** for React (TSX, JS/JSX), Vue, Svelte, CSS and SCSS, Tailwind classes and CSS-in-JS (templates, object styles, MUI `sx`). They decide whether a change can merge.
- **Optional visual diffs** of the built app (Playwright), with changed regions labelled. A difference asks for review; it never fails the build.
- **An optional AI reviewer** that can request review but never block. Its citations are verified against the files it was shown.

Each finding has a rule, a location, the evidence, guidance and a fix, and one outcome: pass, review requested, or fail.

## Install

```bash
npm install --save-dev design-warden      # or: pnpm add -D design-warden, yarn add -D design-warden
```

Node 22.18+ or 24.11+. No API keys are needed: nothing leaves the machine unless you pass `--semantic`.

## Write a policy

The policy is a JSON file that names your token sources, design-system paths, components and rules. Start from the starter policy and its guidance file:

```bash
cp node_modules/design-warden/starter/design-warden.policy.json node_modules/design-warden/starter/GUIDANCE.md .
npx design-warden policy validate      # lists every problem with its path
npx design-warden policy test          # runs the pass/fail examples each rule declares
npx design-warden checks               # the built-in checks a rule can use
```

The starter's `$schema` points at the published JSON Schema, so editors complete and validate the file; `npx design-warden policy schema` prints it.

## Check a change

```bash
npx design-warden check --base origin/main                             # only changed lines can fail; older findings are "pre-existing"
npx design-warden check --base origin/main --policy-ref origin/main    # in CI: the policy comes from the base branch
npx design-warden check --format json --report design-warden.json      # also: markdown, github, sarif, gitlab
```

```text
  FAIL   color/semantic-tokens  src/pages/OverviewPage.css:3:3
         Hardcoded color `#d93025` in `color`.
         -> Use var(--color-text-danger), the closest allowed token (#b91c1c).
```

| Exit code | Meaning |
|---|---|
| 0 | Pass, or review requested |
| 1 | A blocking finding |
| 2 | Invalid policy, usage or setup error |
| 3 | An engine failed (fails closed) |

`npx design-warden --help` lists every option, including visual capture (`design-warden capture`, `--visual-base`, `--visual-head`) and the AI review (`--semantic anthropic | openai-compatible | replay`, with `--semantic-dry-run` to see exactly what would be sent).

## In GitHub Actions

Pin the version, so a pull request cannot change the tool that judges it, and load the policy from the base branch:

```yaml
name: Design Warden
on: pull_request
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0              # the merge base needs history
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
      - run: >
          npx --yes design-warden@0.2.0 check
          --base "origin/$BASE" --policy-ref "origin/$BASE"
          --format github --report "$RUNNER_TEMP/design-warden.json"
        env:
          BASE: ${{ github.base_ref }}
```

`--format github` writes annotations on the changed lines, a job summary and step outputs. `design-warden comment report.json…` turns saved reports into one pull-request comment. Protect the workflow file and the policy with CODEOWNERS and a branch ruleset: on `pull_request`, the pull request's own copy of the workflow runs.

## Security

- The policy is data: it cannot run commands, and every path it names stays inside the project.
- Nothing is sent anywhere unless you pass `--semantic`. Then only changed, in-scope files are sent, capped, with secrets redacted on a best-effort basis. Endpoints and keys come from flags and environment variables, never from the policy.
- Model output is parsed as data, verified against the files it cites, and capped at "review": it can never fail a build.

## License

MIT
