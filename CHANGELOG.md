# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning once 1.0 is released.

## [Unreleased]

### Added

- Visual changes name their likely source. Each changed screen's finding lists up to three stylesheet rules whose selectors use the class of the largest change's element, changed files first, as code evidence. It is labelled a heuristic. The CLI passes `compareCaptures` a lookup from the source engine (`styledBy`), so the visual engine still does not depend on source analysis.
- Rename detection for `--base-dir`. A deleted and an added file with identical content, or with at least 50% of their lines in common and the same extension, pair as a rename, so moved code keeps its findings pre-existing and provenance reads the old version.
- Globally registered Vue components. `app.component('AcmeBadge', Badge)`, `Vue.component(…)` and chained `createApp(App).component(…)` registrations of imported components are read project-wide. Template tags without a local import resolve against them, in both spellings, so prop contracts and provenance apply. A local import wins, as in Vue.
- Tailwind default-palette color classes (`bg-red-500`, `hover:text-white`, `border-t-slate-200/50`) are read as the theme variable Tailwind v4 compiles them to (`var(--color-red-500)`) and judged by `token-usage`, which names the class. Its suggestions name the semantic class with the same value. Sizes and keywords (`text-sm`, `border-2`) and a project's own color names are not judged. A project that uses the default palette on purpose lists Tailwind's `theme.css` as a token source.
- CSS-in-JS object styles. `css({…})`, `styled.div({…})`, `styled(Button)((p) => ({…}))`, `keyframes({…})` and Emotion's `css` prop are read like inline style objects, nested selectors and media queries included. MUI's `sx` prop is read too, reporting only literal raw CSS: numbers, theme paths and computed values are theme lookups.
- Pull-request comments. `design-warden comment <report.json>…` renders saved JSON reports as one markdown comment, and the example workflow's new `comment` job keeps one comment per pull request up to date. It is the only job with write access (`pull-requests: write`). It checks out the base branch only and treats the reports as data. The markdown renderer now escapes or type-checks every report field, because the visual job builds pull-request code and its report may be forged.
- `no-important` check (`styles/no-important` in the demo policy): `!important` in every CSS source: CSS and SCSS files, Vue and Svelte `<style>` blocks, static `style` attributes and CSS-in-JS templates.
- `typography/scale` rule in the demo policy: font sizes must use `--font-size-*` tokens. It reuses `spacing-scale` with other options.
- `spacing-scale` option `units` (any of `px`, `rem`, `em`; default all three). The demo's typography rule leaves out `em`, which is relative to the parent's font size and was suggested a token as if it were `rem`.
- `--format sarif`: SARIF 2.1.0 for GitHub code scanning, with rules, levels from the outcome and stable fingerprints. No SARIF is written when any engine failed or was incomplete, whatever its failure mode, because code scanning reads a partial result as fixed alerts.
- `--format gitlab`: GitLab Code Quality report (Code Climate subset), with the same findings and the same rule for failed engines.
- Tailwind arbitrary values (`p-[13px]`, `text-[#e11d48]`, `[padding:13px]`, `p-(--token)`) in `className` strings, `clsx`/`cn`/`classNames`-style helpers and same-file string constants used as classes are read by the color, spacing, typography and token checks.
- `--base-dir <dir>`: compare with an older copy of the project without git history, using `git diff --no-index`. The policy and token sources are always compared, even when `project.include` leaves them out.
- `accessibility` check (`a11y/no-new-violations` in the demo policy): axe-core 4.14.0 (MPL-2.0, a new dependency) runs on every captured state, injected from `node_modules`. Violations that are new in head are probable violations, so at most a review request. Elements are matched by their HTML rather than axe's positional selectors, and results are compared only within one environment and with the same axe-core version and tags, which the capture manifest records.
- Vue single-file components (`@vue/compiler-dom` 3.5.43) and Svelte components (`svelte` 5.57.2), new dependencies loaded only when such a file is parsed. Markup elements, attributes, `class`/`style` bindings and `<style>` blocks are read by every check, at their positions in the file. Namespaced components (`<DS.Badge>`), Vue's same-name shorthand (`:tone`) and Svelte snippets are understood; markup in another language (`<template lang="pug">`) or loaded with `src` is reported as unparseable instead of passing unread.
- Committed visual baselines are documented and tested (capture into a committed directory, compare later runs with it). A baseline from another environment is refused with guidance on how to capture a matching one.
- Provenance uses tree shape as a second signal (Zhang-Shasha tree edit distance on the JSX nesting): a rearranged component is `modified`, and a new layout made of a pattern's components is no longer `established`. Trees over 300 nodes are compared by composition only, which keeps the cost bounded.
- Approvals (ADR 0012): `approvals[]` in the policy clears one accepted review request by fingerprint, never a blocking finding. They require an approver, a reason and an expiry, are read from the trusted policy source (the base ref in CI), and each added, changed or removed approval is listed in `policy/changed`. The fingerprint covers a multi-line finding's whole span, so an edit anywhere inside an approved component brings its review request back.
- npm packaging: `pnpm build` emits `dist/` with declarations (`tsc -b`), `publishConfig` points packed `exports` and `bin` at it, and `pnpm test:pack` installs the tarballs into a fresh project and runs `design-warden`. The repository still runs from source.
- DTCG token files (`*.tokens.json`, format 2025.10) as token sources: names derived from token paths, aliases and `$ref` resolved, `$extends` merged. Deprecated tokens are reported by `token-usage` and never suggested. Circular `$extends`, runaway expansion and oversized token files stop the source engine instead of hanging it.
- SCSS (`postcss-scss` 4.0.9, a new dependency): `.scss` files are checked like CSS; `$variables`, `#{}` interpolation and mixins with arguments are insufficient evidence. CSS-in-JS templates are now parsed with it too, so `//` comments no longer make a template unreadable.
- CSS-in-JS: `styled`, `css`, `createGlobalStyle`, `keyframes` and `injectGlobal` templates are parsed with PostCSS. Interpolated values and properties are insufficient evidence; templates that cannot be parsed are reported instead of skipped.

### Changed

- A pure git rename (similarity 100%) changes no lines, so a moved file's findings stay pre-existing. It used to count as changed everywhere, because it has no hunks.
- Renamed from Design Guard to Design Warden, because the `design-guard` npm package and the `@design-guard` npm scope belong to another project. Everything that carried the name changed with it: the CLI (`design-warden`), the packages (`@design-warden/*`), the policy file (`design-warden.policy.json`), the output directory (`.design-warden/`), the inline directive (`design-warden-ignore-next-line`), the provider variables (`DESIGN_WARDEN_OPENAI_*`), the report's `tool.name` and the SARIF fingerprint key (`designWarden/v1`). Nothing was published under the old name, so the old names are not accepted as aliases.
- The workflows pin every action to a full commit SHA (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2), checked by a test.
- `spacing-scale` messages name the configured scale (for example "is not on the `--space-*` scale") instead of always saying "spacing".
- The visual job's Playwright container is pinned by digest, and a test keeps its tag equal to the `playwright` npm version.
- `capture --serve` exits 2 before starting a browser when the directory has no `index.html`, instead of failing every state and exiting 3.

### Fixed

- The example workflow's visual job uploaded its report but never the diff images: in a container job, `${{ runner.temp }}` is the host's path, which does not exist inside the container. The job now writes to `.design-warden/ci` in the workspace, and a test rejects host-path expressions in that job.
- Outside Windows, a visual scenario run listed `node_modules` as a changed file. The workspace links the demo's dependencies through a symlink there (a junction on Windows), and the workspace's git exclude used `node_modules/`, which matches only directories.
- The inspector service stopped answering while it compared screenshots (4–11 s for the demo), and could reset keep-alive connections. `compareCaptures` is now async and yields between captures.
- `.js` and `.jsx` files are parsed as JavaScript with JSX. A `.js` file containing JSX used to be reported as unparseable.
- Provenance reads a reference pattern from the base when the change edits the reference file itself, so editing a reference can no longer make new code look established.

## [0.1.0] - 2026-10-10

First working version.

### Added

- **Policy format v1:**
  - categories, severity, enforcement, scopes, component registry, reference patterns, guidance index;
  - policy exceptions with expiry; inline exceptions with rules and reasons;
  - visual and semantic configuration; failure policy;
  - zod validation, generated JSON Schema, executable rule examples (`design-warden policy test`).
- **Deterministic source checks** (Babel 8, PostCSS): `no-hardcoded-color`, `spacing-scale`, `token-usage`, `raw-element`, `component-props`, `duplicate-component`, `pattern-provenance`, `shared-change`.
  - Built-in governance rules: `policy/changed`, `policy/exception-expired`, `policy/inline-exception-rejected`, `analysis/unparseable-file`.
- **Git change sets:** merge base to working tree, including untracked files; changed-line scoping; `--policy-ref`.
- **Visual analysis:** deterministic Playwright capture, pixelmatch 8 diff, region clustering with element labels, environment fingerprints.
- **Semantic review:** Anthropic (SDK) and OpenAI-compatible providers, a replay provider, structured output, verification of every reference, dry run.
- **CLI** with terminal, JSON, markdown and GitHub output, and documented exit codes.
- **Demo app** (Acme Console) with its design skill and policy; 11 seeded scenarios; scenario harness (`run`, `apply`, `reset`).
- **Inspector:** a loopback-only local service and a web UI.
- **Evaluation:** deterministic benchmark with a pinned baseline, and opt-in semantic evaluation.
- **CI:** repository workflow, with a dependency audit, and an example Design Warden workflow. Each job runs a trusted base-branch copy of the tool; the review-only jobs use `--only visual|semantic`.
- **Documentation:** research notes, ADRs, guides, threat model.
- **Claude Code guidance:** CLAUDE.md, three skills, three review agents.

### Security

Hardening from the pre-release reviews (docs/security.md, P2-P12):
- change sets that file names or git attributes cannot evade;
- GitHub log output that repository text cannot turn into workflow commands;
- redacted and fenced prompt sections;
- capture WebSockets limited to the app's host;
- link and autolink escaping in summaries.
