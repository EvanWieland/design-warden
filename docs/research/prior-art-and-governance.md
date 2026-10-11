# Prior art: design linting, a11y testing, component governance and AI-UI verification

Last verified: 2026-10-10

"/wk" means npm downloads in the week 2026-10-02 to 10-08 (CI installs inflate these). DW means Design Warden.

## Questions

1. What does axe (and tools built on it) detect, and should DW integrate it?
2. Can boundary tools enforce "use design-system (DS) controls" and "no deep imports"?
3. How do teams govern shared components and spot re-implemented ones?
4. Do AI-UI tools guide generation, or check the result afterwards?
5. Which UI evaluations can safely gate a PR?
6. What should DW reuse, where does it differ, and what should it avoid?

## Findings

**Accessibility**
- **axe-core** claims it finds "on average 57% of WCAG issues". It aims for zero false positives and returns uncertain results as `incomplete`. Version 4.14, licence MPL-2.0. [Verified](https://github.com/dequelabs/axe-core)
  - The 57% is a share of all issue instances found across 2,000+ first-time Deque audits (a 2021 vendor study). It is not a share of WCAG criteria covered. [Verified](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues)
- **GOV.UK (2017):** the best of 10 tools caught 37–41% of 143 planted barriers. 29% were missed by every tool. [Verified](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/)
- **`@axe-core/playwright`** (13.7M/wk): `new AxeBuilder({ page }).include().withTags()….analyze()`. [Verified](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md)
- **Storybook** (v10.6): the a11y addon is axe. `parameters.a11y.test: 'error'|'todo'|'off'` decides whether failures break CI, via the Vitest addon. The old test-runner is archived. [Verified](https://storybook.js.org/docs/writing-tests/accessibility-testing) [Verified](https://github.com/storybookjs/test-runner)
- **Lighthouse** scores whole pages with pass/fail audits weighted by axe impact. LHCI can assert a minimum `categories:accessibility` score. [Verified](https://developer.chrome.com/docs/lighthouse/accessibility/scoring) [Verified](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md)

**Import boundaries**
- **ESLint built-ins already cover "controls come from @acme/ds":**
  - `no-restricted-imports`, using `importNames`/`importNamePattern` plus a message. [Verified](https://eslint.org/docs/latest/rules/no-restricted-imports)
  - `react/forbid-elements` ("forbid all `<div />` and use `<Box />`"). [Verified](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/forbid-elements.md)
- **eslint-plugin-boundaries** v7 (1.9M/wk): the `dependencies` rule, plus the deprecated but working `entry-point`, `no-private` and `external` rules. Together they cover deep imports and single named imports (`{ Link }`). [Verified](https://www.jsboundaries.dev/docs/rules/)
- **dependency-cruiser** (5.1M/wk): forbidden/allowed/required rules matched on path regexes. [Verified](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) It works per module, not per named import. [Inferred]
- **Nx:** tag constraints, `bannedExternalImports`, and "Projects cannot be imported by a relative or absolute path…". [Verified](https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts)
- **Sheriff:** each module's `index.ts` is its public API, plus tag `depRules`. Ships as an ESLint plugin and a CLI. [Verified](https://github.com/softarc-consulting/sheriff)
- **Node `exports`:** subpaths not listed in package.json `exports` fail to import with `ERR_PACKAGE_PATH_NOT_EXPORTED`. [Verified](https://nodejs.org/api/packages.html)

**Governance and spotting re-implementations**
- **CODEOWNERS** matches file paths only. [Verified](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) So a Button rebuilt under `app/` never reaches the DS owners. [Inferred]
- **react-scanner** (240k/wk) counts how DS components and props are used, by import source. It does not find re-implementations. [Verified](https://github.com/moroshko/react-scanner)
- **Radius Tracker** (no commits since 2024-07) labels as "homebrew" any local component that renders raw lowercase JSX. Support for CSS-in-JS is only partial. It is the only open heuristic I found. [Verified](https://github.com/rangle/radius-tracker)
- **Omlet** markets "surface similar components". [Verified](https://omlet.dev/) How it works is not public. [Unresolved]
- **Figma:**
  - Library analytics log detached instances, which roughly correspond to a "modified pattern". [Verified](https://help.figma.com/hc/en-us/articles/360039238353-Track-library-and-component-usage)
  - "Check designs" flags hard-coded values, assets from the wrong library, detached components and contrast. Figma says it "does not use LLMs". [Verified](https://help.figma.com/hc/en-us/articles/39592284074263-Check-designs-in-Figma)
- **DS teams write policy as lint rules:**
  - Atlassian: e.g. `ensure-design-token-usage`, `no-html-button`, `use-primitives`. [Verified](https://atlassian.design/components/eslint-plugin-design-system/usage)
  - Salesforce SLDS Linter: e.g. `no-hardcoded-values`. [Verified](https://github.com/forcedotcom/sf-skills)

**AI-generated UI: guidance during generation (most tools)**
- **These tools only feed context to the generator; none documents a check on the output:**
  - Figma MCP (`get_design_context`, `search_design_system`, `get_code_connect_map`, `create_design_system_rules`) [Verified](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
  - shadcn MCP/registries [Verified](https://ui.shadcn.com/docs/mcp)
  - Figma Make kits (2026-04) [Verified](https://www.figma.com/blog/introducing-make-kits-and-make-attachments/)
  - Builder.io indexing [Verified](https://www.builder.io/c/docs/component-indexing)
  - Anima, marketing page only [Verified](https://animaapp.com/use-cases/design-systems)
- **v0's docs** say it "is specifically trained on the default implementations of the shadcn/ui components and may struggle with any customizations." [Verified](https://v0.app/docs/design-systems)
- **Storybook MCP** (preview):
  - Its docs tools read the components manifest, whose schema is "not yet stable and should not be considered a public API".
  - `test-run` runs component and a11y tests so the agent can fix its own failures. There are no visual or DS-compliance checks.
  - The version Chromatic hosts has the docs tools only.
  - [Verified](https://storybook.js.org/docs/ai/mcp/overview) [Verified](https://storybook.js.org/docs/ai/manifests) [Verified](https://www.chromatic.com/docs/mcp/)
- **Primer's MCP** lets the agent check its own work with `lint_css` (token usage) and `review_alt_text`. [Verified](https://primer.style/product/getting-started/foundations/mcp)
- **Chromatic's marketing** says it will "force agents to reuse existing components". It does this through context, tests and human review, not detection. [Verified](https://www.chromatic.com/ai)

**AI-generated UI: verification (new and changing fast)**
- **`@shadcn/lint`** is the main tool:
  - MIT, first released 2026-09-14, 3.1k stars, about 1.5M/wk.
  - An ESLint/Oxlint linter for Tailwind v4 (React/Vue/Svelte), built for agents to run.
  - Six rules, e.g. `no-restyle` (which classes each component accepts), `no-arbitrary-values` and `no-raw-colors`.
  - Each error suggests a fix drawn from the project's own components and theme.
  - Its own eval: across 150+ agent runs, near-zero violations after one correction round. In the Claude control runs, fixing cost 10–48% less than with rules alone.
  - [Verified](https://github.com/shadcn-ui/lint)
- **Salesforce `sf-skills`:** `slds-apply` builds; `slds-validate` runs the linter and a script, then a "required manual review gate" and a scorecard, with no WCAG checks. This is the closest analogue to "the skill instructs, a tool verifies", but the agent grades its own work and it covers only SLDS. [Verified](https://github.com/forcedotcom/sf-skills/blob/HEAD/skills/design-systems-slds-validate/SKILL.md)
- **Small open-source tools, all rule-based first:**
  - Buoy (20★): comments on PRs about hard-coded values and `ButtonV2`-style naming drift. [Verified](https://github.com/ahoybuoy/buoy)
  - Deslint (7★): ESLint plugin, MCP server and GitHub Action. [Verified](https://deslint.com/)
  - onsystem (created 2026-10-06): `no-unknown-component`, `prefer-design-system-component`, and a CI baseline. [Verified](https://github.com/dgesteves/onsystem)
  - DesignDiff: compares Figma against CSS computed in Playwright (marketing page only). [Verified](https://designdiff.netlify.app/)
- **No per-PR classifier found:** I found no tool that sorts each changed component into established, modified, novel or insufficient evidence. [Inferred] (search not exhaustive)

**Research**
- **Context alone falls short:** in a CHI EA '26 study, a registry of pre-built components worked best, reaching 95.08% DS compliance on 6 UIs. [Verified](https://doi.org/10.1145/3772363.3798616) (abstract from search only; ACM returned 403)
- **LLM critique helps but is noisy:**
  - GPT-4 caught subtle errors but got less useful over iterations. [Verified](https://arxiv.org/abs/2403.13139)
  - Expert critiques used as examples (UICrit) improved feedback by 55%. [Verified](https://arxiv.org/abs/2407.08850)
  - Iterative visual prompting closed half the gap to human experts on one metric. [Verified](https://arxiv.org/abs/2412.16829)
- **Models judge aesthetics poorly:**
  - In UIClip, GPT-4V-era models were "around the level of random chance" at picking the better of two designs. [Verified](https://arxiv.org/abs/2404.12500)
  - In "MLLM as a UI Judge" (2025), models agreed with human ratings on some dimensions but not others. [Verified](https://arxiv.org/abs/2510.08783)
- **Checklists help:** ArtifactsBench's checklist-guided judge ranked models 94.4% consistently with WebDev Arena, and agreed with experts on over 90% of pairwise comparisons. [Verified](https://arxiv.org/abs/2507.04952)
- **Concrete rules automate well:**
  - UIS-Hunter checked 93 Material Design rules at precision 0.81 and recall 0.90. [Verified](https://2021.icse-conferences.org/details/icse-2021-papers/87/Don-t-Do-That-Hunting-Down-Visual-Design-Smells-in-Complex-UIs-against-Design-Guidel)
  - DesignRepair (ICSE '25) checks both the code and the page rendered in Playwright, then repairs with an LLM. [Verified](https://arxiv.org/abs/2411.01606)
  - C³ detected duplicated components at precision 0.93 and recall 0.91 on one Huawei product. [Verified](https://2023.esec-fse.org/details/fse-2023-industry/24/C-Code-Clone-Based-Identification-of-Duplicated-Components)
  - Design2Code measures how closely code matches a design, not whether it follows a DS. [Verified](https://arxiv.org/abs/2403.03163)

## Implications for Design Warden

1. **Accessibility: an adapter, not an engine.**
   - Optionally run `@axe-core/playwright` on states DW already renders, scoped with `include()` to the changed components.
   - Report results as evidence, never as a score. Defer to Storybook a11y gates where they exist, and skip Lighthouse CI.
   - The unique value is combining signals: "a new component with axe violations its DS equivalent lacks" is the strongest case for using the DS component.
2. **Imports: delegate.** Generate config for ESLint, boundaries, Nx or Sheriff from the design skill and read their JSON or SARIF output. Recommend `exports` on the DS package. DW needs its own import graph only for provenance.
3. **Token and class lint is now commodity.** On Tailwind v4, recommend `@shadcn/lint` and read its results. Write native checks only where they need the skill's context, such as conformance to its reference implementations.
4. **Bet on provenance plus evidence.**
   - **"Established":** seed from DS exports, Code Connect, the Storybook manifest (read through a version-pinned adapter) and the skill's reference implementations.
   - **"Modified":** use code-clone evidence from jscpd plus prop and class differences.
   - **"Novel":** flag local components that render raw DOM elements, the heuristic Radius Tracker uses.
   - Make "insufficient evidence" a first-class result. Measure precision on labelled past PRs before letting it block a merge.
5. **A CI gate is needed but not unique**: Buoy, Deslint and onsystem gate too. Stand out on three things:
   - The same design skill both instructs the agent and configures DW.
   - The inspector shows the diff, screenshots, provenance and verified LLM notes together.
   - DW can label PRs that add new patterns outside DS paths, which CODEOWNERS can't.
6. **LLM review:** drive it with the skill's checklists and use the team's own reference implementations as examples. Findings stay advisory unless re-checked locally against a file and line, selector, token or computed style. Never gate on aesthetics.
7. **Screenshots are evidence, not visual regression tests.** Rendering varies by environment. [Verified](https://playwright.dev/docs/test-snapshots) Leave baselines to Playwright or Chromatic.
8. **Agent-readable findings with fix hints.** The shadcn eval suggests this makes self-correction cheap, in the agent loop and in CI alike.
9. **Tokens:** read DTCG 2025.10 rather than inventing a format. [Verified](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)

**Do not compete on:**
- a11y engines
- visual regression services
- boundary engines
- Tailwind lint
- adoption dashboards
- DS-context MCP servers
- UI generation
- Figma-file lint

## Open questions

- How precise can provenance be? Past "use the DS component" review comments could serve as labels.
- Will `@shadcn/lint`, Chromatic or onsystem add re-implementation detection? DW's lead there is thin.
- Unverified: how Omlet finds similar components, and which plans Code Connect requires.
- How the CHI EA '26 paper measured compliance. I did not read the full text.
- axe's MPL-2.0 licence is probably fine for an unmodified dependency [Inferred], but confirm.

## Sources

- [axe-core](https://github.com/dequelabs/axe-core), [Deque study](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues): coverage claims (vendor).
- [GOV.UK audit](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/): independent baseline.
- [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md): API.
- Storybook docs: [a11y](https://storybook.js.org/docs/writing-tests/accessibility-testing), [MCP](https://storybook.js.org/docs/ai/mcp/overview), [manifests](https://storybook.js.org/docs/ai/manifests), [test-runner](https://github.com/storybookjs/test-runner).
- Lighthouse: [scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring), [LHCI](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md).
- Boundaries: [no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports), [forbid-elements](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/forbid-elements.md), [boundaries](https://www.jsboundaries.dev/docs/rules/), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [Nx source](https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts), [Sheriff](https://github.com/softarc-consulting/sheriff), [Node exports](https://nodejs.org/api/packages.html).
- Governance: [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners), [react-scanner](https://github.com/moroshko/react-scanner), [Radius Tracker](https://github.com/rangle/radius-tracker) (source read), [Omlet](https://omlet.dev/) (marketing).
- Figma: [analytics](https://help.figma.com/hc/en-us/articles/360039238353-Track-library-and-component-usage), [Check designs](https://help.figma.com/hc/en-us/articles/39592284074263-Check-designs-in-Figma), [MCP tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/), [Make kits](https://www.figma.com/blog/introducing-make-kits-and-make-attachments/).
- DS vendors: [Atlassian lint](https://atlassian.design/components/eslint-plugin-design-system/usage), [sf-skills](https://github.com/forcedotcom/sf-skills), [Primer MCP](https://primer.style/product/getting-started/foundations/mcp).
- Generation-time tools: [Chromatic MCP](https://www.chromatic.com/docs/mcp/), [Chromatic AI](https://www.chromatic.com/ai) (marketing), [shadcn MCP](https://ui.shadcn.com/docs/mcp), [v0](https://v0.app/docs/design-systems), [Builder](https://www.builder.io/c/docs/component-indexing), [Anima](https://animaapp.com/use-cases/design-systems) (marketing).
- Verifiers: [@shadcn/lint](https://github.com/shadcn-ui/lint), [Buoy](https://github.com/ahoybuoy/buoy), [Deslint](https://deslint.com/), [onsystem](https://github.com/dgesteves/onsystem), [DesignDiff](https://designdiff.netlify.app/).
- Papers: [CHI EA '26](https://doi.org/10.1145/3772363.3798616), [CHI '24](https://arxiv.org/abs/2403.13139), [UICrit](https://arxiv.org/abs/2407.08850), [visual prompting](https://arxiv.org/abs/2412.16829), [UIClip](https://arxiv.org/abs/2404.12500), [MLLM judge](https://arxiv.org/abs/2510.08783), [ArtifactsBench](https://arxiv.org/abs/2507.04952), [UIS-Hunter](https://2021.icse-conferences.org/details/icse-2021-papers/87/Don-t-Do-That-Hunting-Down-Visual-Design-Smells-in-Complex-UIs-against-Design-Guidel), [DesignRepair](https://arxiv.org/abs/2411.01606), [C³](https://2023.esec-fse.org/details/fse-2023-industry/24/C-Code-Clone-Based-Identification-of-Duplicated-Components), [Design2Code](https://arxiv.org/abs/2403.03163).
- Other: [Playwright snapshots](https://playwright.dev/docs/test-snapshots), [DTCG](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/), [jscpd](https://www.npmjs.com/package/jscpd). Download counts come from `api.npmjs.org`.
