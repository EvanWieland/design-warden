# Design contracts: tokens, component metadata, agent guidance

Last verified: 2026-10-10

## Questions

1. DTCG status, structure, modes and tooling; DTCG JSON or built CSS variables as linter input?
2. What fields do the component metadata formats carry?
3. What machine-readable guidance exists for agents, and what prior art exists for *enforceable* rules?
4. How do mature systems grade guidance strength?

## Findings

**Design tokens**
- DTCG **2025.10** is stable: Format, Color, Resolver modules, "Final Community Group Report" (not a W3C Standard), 2025-10-28. [Verified](https://www.designtokens.org/TR/2025.10/)
- Format: token = `$value` + optional `$type`, `$description`, `$extensions` (vendor data), `$deprecated` (bool or string); groups nest, `$extends` inherits a group, `$root` names a group's base token. Aliases: `{group.token}` (whole value) and JSON Pointer `$ref` (property-level); cycles invalid. `$type` comes from token → referenced token → nearest group, and "Tools MUST NOT attempt to guess the type". Values are objects (dimension `{value, unit: px|rem}`, color `{colorSpace, components, …}`). Media type `application/design-tokens+json`. [Verified](https://www.designtokens.org/TR/2025.10/format/) There is an official JSON Schema, though the schema file doesn't say whether it's normative. [Verified](https://www.designtokens.org/schemas/2025.10/format.json)
- Modes live in the Resolver module (`.resolver.json`: sets, modifiers/contexts such as light/dark, `resolutionOrder`), not in Format. [Verified](https://www.designtokens.org/TR/2025.10/resolver/)
- Adoption is uneven. Style Dictionary (DTCG since v4) says 2025.10 "does not have full support yet". [Verified](https://styledictionary.com/info/dtcg/) Its current release is v5.6.1. [Verified](https://github.com/style-dictionary/style-dictionary/releases) Tokens Studio still defaults to its legacy format. [Verified](https://docs.tokens.studio/manage-settings/token-format) Terrazzo documents resolvers. [Verified](https://terrazzo.app/docs/guides/resolvers/) Figma imports and exports DTCG JSON one file per mode. Imported dimensions must be px, cross-collection aliases go in `$extensions` `com.figma.aliasData`, and names are normalized to `a/b/c`. [Verified](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)
- Tailwind v4 `@theme` emits plain CSS variables (`--color-*`, `--spacing-*`…). [Verified](https://tailwindcss.com/docs/theme) shadcn ships themes as `cssVars`. [Verified](https://ui.shadcn.com/docs/registry/registry-item-json)
- Reading cost. DTCG needs group walking, type inheritance, two alias syntaxes with cycle checks, `$extends` merging, color-space math and a resolver for modes. It also leaves the token→CSS-variable name mapping to each pipeline. CSS is a postcss walk over `--*` per selector/media query plus `var()` chasing, with no types or deprecation. Code references the **emitted names**, so CSS is the universal ground truth and DTCG is the richer metadata. [Inferred]

**Component metadata**
- Storybook `argTypes` (control, description, options, mapping, table.*, type, if) has no deprecation field. [Verified](https://storybook.js.org/docs/api/arg-types) Custom tags such as `experimental`/`deprecated` are only a suggested convention. [Verified](https://storybook.js.org/docs/writing-stories/tags)
- Storybook 10.6 AI **manifests** (preview; React, Angular-vite, Vue3-vite): `components.json` entries carry `id, name, path, description, stories[{snippet}], import, jsDocTags, reactDocgen{props}, subcomponents`; `docs.json` carries the raw MDX. The `!manifest` tag hides anti-pattern stories. Storybook says the schema "should not be considered a public API". [Verified](https://storybook.js.org/docs/ai/manifests) `@storybook/addon-mcp` exposes `docs-list`, `docs-show` and `test-run` (tests plus a11y), and suggests adding AGENTS.md instructions to use them. [Verified](https://storybook.js.org/docs/ai/mcp/overview)
- react-docgen-typescript returns `{displayName, description, props, methods, tags}`. Props carry `required, type, defaultValue, tags`, and JSDoc `@deprecated` lands in `tags`. [Verified](https://raw.githubusercontent.com/styleguidist/react-docgen-typescript/master/src/parser.ts) I didn't check whether react-docgen captures JSDoc tags. [Unresolved](https://react-docgen.dev/docs/reference/documentation/basic)
- Custom Elements Manifest 2.1.0: `tagName, attributes, members, events, slots, cssParts, cssProperties, cssStates`, with `deprecated: boolean|string` at nearly every level. [Verified](https://github.com/webcomponents/custom-elements-manifest/blob/main/schema.d.ts)
- Figma Code Connect maps design props to code props (`figma.enum/boolean/instance/slot…`) with variant restrictions, examples and imports. Framework parsers are now legacy, and `.figma.ts` templates are the only maintained path. [Verified](https://developers.figma.com/docs/code-connect/react/) The Figma MCP server's `create_design_system_rules` prompt writes an agent rules file (instructions, not checks). [Verified](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts)
- A shadcn `registry-item` has name, type, files, dependencies, `registryDependencies`, `cssVars`, `docs` (markdown) and `meta`. It has no props and no deprecation field. [Verified](https://ui.shadcn.com/docs/registry/registry-item-json)
- None of these formats states a checkable constraint such as "use `Button`, never raw `<button>`". Only CEM, DTCG and JSDoc treat deprecation as data; usage guidance is always prose. [Inferred]

**Agent guidance & enforceable-rule prior art**
- Agent Skills (an open standard that started at Anthropic): only the `name` (≤64) and `description` (≤1024) fields are structured. `metadata` is a free string map, and the body is free Markdown. [Verified](https://agentskills.io/specification) AGENTS.md has no required fields, the nearest file wins, and it is stewarded by the Linux Foundation's Agentic AI Foundation. [Verified](https://agents.md/) llms.txt is still a proposal (v2). [Verified](https://llmstxt.org/)
- Atlassian runs an MCP server (`@atlaskit/ads-mcp`). Its internal `atlassian-design-system` skill is "generated from the same content" as its llms.txt. Two ESLint plugins enforce the rules (`ensure-design-token-usage`, `no-deprecated-imports`, `no-html-button`…). [Verified](https://atlassian.design/llms.txt) [Verified](https://unpkg.com/@atlaskit/eslint-plugin-design-system/README.md)
- Validators exposed to agents:
  - Primer MCP's `lint_css` ("Checks CSS for Primer token usage"). [Verified](https://primer.style/product/getting-started/foundations/mcp)
  - Shopify dev-mcp validates GraphQL, Liquid and UI-extension code. [Verified](https://unpkg.com/@shopify/dev-mcp/README.md)
  - Carbon MCP lists a `code_audit` tool. What it checks is [Unresolved](https://carbondesignsystem.com/developing/carbon-mcp/onboarding-and-setup/).
- The SLDS Linter is ESLint-based and writes SARIF reports. [Verified](https://unpkg.com/@salesforce-ux/slds-linter/README.md) I saw its error/warning definitions only in a search snippet (the page blocked fetching). [Unresolved](https://developer.salesforce.com/docs/platform/slds-linter/guide/reference-rules.html)
- Google Labs **DESIGN.md** (alpha) has YAML tokens plus prose sections including "Do's and Don'ts". Its 11 fixed-severity lint rules check the DESIGN.md file itself, not app code. It exports DTCG and Tailwind v4. [Verified](https://github.com/google-labs-code/design.md)
- I found no cross-vendor standard for design rules. [Inferred] Closest analogs:
  - Polaris `polaris/coverage`: categories (color, space, typography, motion…), per-rule `severity`, a per-category message, and `reportDescriptionlessDisables`. [Verified](https://raw.githubusercontent.com/Shopify/polaris/main/stylelint-polaris/index.js)
  - Spectral: rule id with `severity` (error/warn/info/hint/off). [Verified](https://raw.githubusercontent.com/stoplightio/spectral/develop/docs/guides/4a-rules.md)
  - Google AIP + api-linter: IDs like `core::0140::lower-snake`, disabled with inline `(-- api-linter: … --)`. [Verified](https://linter.aip.dev/configuration)
  - Zalando: `[101] MUST …` plus the Zally linter. [Verified](https://opensource.zalando.com/restful-api-guidelines/)

**Strength classification**
- BCP 14: MUST/SHOULD/MAY, normative only in capitals (RFC 8174). [Verified](https://www.rfc-editor.org/rfc/rfc8174) AIP-8 adds two rules: a SHOULD "must include valid examples of where other concerns may override", and rationale "must not contain guidance". [Verified](https://google.aip.dev/8)
- Severity is kept separate from strength. [Inferred] axe has impact (minor…critical) as a separate axis from tags (`wcag2aa` vs `best-practice`). [Verified](https://raw.githubusercontent.com/dequelabs/axe-core/develop/doc/API.md) Primer has a lifecycle status: Experimental/Ready/Deprecated ("should be avoided", a warning is shown). [Verified](https://primer.style/guides/component-lifecycle) SARIF has `defaultConfiguration.level`, and GitHub accepts note/warning/error. [Verified](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)

## Implications for Design Warden

1. **Tokens:** make built CSS custom properties (per selector or media query = mode) the default token source. Add an optional `dtcg` (2025.10 Format) adapter for metadata: `$type`, `$description`, `$deprecated` → deprecated-token findings. Require an explicit path→`--var` naming rule; don't guess. Skip the Resolver module for now and accept one file per mode (that's how Figma exports). Error on `$extends`/`$ref` until they're implemented. Tailwind v4 and shadcn come free with the CSS adapter.
2. **Component registry:** keep it thin: name, import specifiers, status (`stable|deprecated` + `replacement`), raw-element→component substitutions, and optional allowed prop values. Optional importers for react-docgen-typescript and CEM. Treat Storybook manifests as best-effort only (preview, unstable schema). Link to usage guidance; don't model it.
3. **Categories:** document the BCP 14 mapping: mandatory = MUST/MUST NOT; required-pattern = MUST (a presence check, really a rule *kind*); preferred = SHOULD, which must name its allowed exceptions (AIP-8); advisory = MAY/informational. Keep severity and enforcement as separate axes. Default SARIF levels: error/error/warning/note.
4. **Rule IDs:** stable, namespaced, never reused (`dw/<area>/<slug>`). Each gets a `helpUri` to its guidance (e.g. a Skill reference anchor), emitted as SARIF `reportingDescriptor`s.
5. **Exceptions:** inline disables must carry a justification (plus owner and expiry), as with Polaris `reportDescriptionlessDisables`. Report unused disables, and emit SARIF `suppressions[].justification`.
6. **Agents:** don't parse SKILL.md or AGENTS.md; they're prose. The policy is the source of truth; later, optionally generate a Skill `references/` file from it (Atlassian's single-source pattern). Ship `design-warden check --format json` as the agent's self-check (precedent: Primer `lint_css`, Shopify validate, Storybook `test-run`) and document it in the team's Skill. An MCP wrapper can wait.
7. **Ignore for v1:** llms.txt, the DTCG resolver, DESIGN.md (alpha, and it exports DTCG anyway), Figma rules files and Code Connect.

## Open questions

- Which token→CSS-variable naming transform and which Tailwind usage does the team have (classes vs `var()`)?
- Does the team's pipeline emit 2025.10 object values? Style Dictionary support is partial.
- Will the Storybook manifest schema stabilize (v11 is in alpha)?
- What do Carbon's `code_audit` and SLDS's severity definitions actually contain?
- Do mode-aware checks (contrast per theme) justify implementing the resolver?

## Sources

- [DTCG 2025.10](https://www.designtokens.org/TR/2025.10/), [Format](https://www.designtokens.org/TR/2025.10/format/), [Resolver](https://www.designtokens.org/TR/2025.10/resolver/), [JSON Schema](https://www.designtokens.org/schemas/2025.10/format.json): spec text
- [DTCG announcement](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/): the adopters it names
- [Style Dictionary DTCG](https://styledictionary.com/info/dtcg/), [releases](https://github.com/style-dictionary/style-dictionary/releases): partial 2025.10 support
- [Tokens Studio](https://docs.tokens.studio/manage-settings/token-format), [Terrazzo resolvers](https://terrazzo.app/docs/guides/resolvers/), [Figma import/export](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables): tool support
- [Tailwind theme](https://tailwindcss.com/docs/theme): `@theme` → CSS vars
- Storybook [manifests](https://storybook.js.org/docs/ai/manifests), [MCP](https://storybook.js.org/docs/ai/mcp/overview), [tags](https://storybook.js.org/docs/writing-stories/tags), [argTypes](https://storybook.js.org/docs/api/arg-types): metadata and agent tools
- [react-docgen-typescript](https://raw.githubusercontent.com/styleguidist/react-docgen-typescript/master/src/parser.ts), [react-docgen](https://react-docgen.dev/docs/reference/documentation/basic), [CEM schema](https://github.com/webcomponents/custom-elements-manifest/blob/main/schema.d.ts): prop/deprecation fields
- [Code Connect](https://developers.figma.com/docs/code-connect/react/), [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts), [shadcn registry-item](https://ui.shadcn.com/docs/registry/registry-item-json): mappings, registries
- [Agent Skills](https://agentskills.io/specification), [AGENTS.md](https://agents.md/), [llms.txt](https://llmstxt.org/): agent-guidance formats
- [Atlassian llms.txt](https://atlassian.design/llms.txt), [ADS ESLint](https://unpkg.com/@atlaskit/eslint-plugin-design-system/README.md), [Primer MCP](https://primer.style/product/getting-started/foundations/mcp), [Primer lifecycle](https://primer.style/guides/component-lifecycle): agent channels
- [Shopify dev-mcp](https://unpkg.com/@shopify/dev-mcp/README.md), [Carbon MCP](https://carbondesignsystem.com/developing/carbon-mcp/onboarding-and-setup/), [SLDS Linter](https://unpkg.com/@salesforce-ux/slds-linter/README.md): validators
- [DESIGN.md](https://github.com/google-labs-code/design.md): Google Labs agent design file plus linter (alpha)
- [Polaris stylelint](https://raw.githubusercontent.com/Shopify/polaris/main/stylelint-polaris/index.js): coverage categories (repo archived 2026-09-11)
- [Spectral](https://raw.githubusercontent.com/stoplightio/spectral/develop/docs/guides/4a-rules.md), [api-linter](https://linter.aip.dev/configuration), [AIP-8](https://google.aip.dev/8), [Zalando](https://opensource.zalando.com/restful-api-guidelines/): rule-ID and strength precedents
- [axe-core](https://raw.githubusercontent.com/dequelabs/axe-core/develop/doc/API.md), [GitHub SARIF](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174): severity axes, SARIF levels, BCP 14
