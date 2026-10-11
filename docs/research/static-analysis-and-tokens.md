# Static analysis and design-token enforcement

Last verified: 2026-10-10

"Local" means I ran it on Windows 11 with Node 24.21. "Source" means I read the code from `npm pack` of that exact version.

## Questions

1. Which TSX parser, given that TS 7 has no stable JS API?
2. ESLint 10 as the host, or our own engine?
3. Stylelint 17 or PostCSS for CSS tokens, and how does each treat `var()`?
4. What can we borrow from existing design-system linters?
5. How do component-usage indexers work?

## Findings

**TypeScript 7**
- TS 7.0 (2026-07-08) "does not ship with an API". 7.1 promises "a new (and different) API". Until then, tools should run TS 6 alongside (`@typescript/typescript6`). [Verified](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- npm has no 7.1 beta. `next` is 7.1.0-dev.20261010.1, which drops the `unstable/` export prefix. A third-party "Oct 6 beta" claim doesn't match npm. [Verified](https://www.npmjs.com/package/typescript)
- After 7.1 stable, the API is intended to stay backward-compatible across 7.x, excluding watch/incremental/build. [Verified](https://github.com/microsoft/TypeScript/issues/64709)
- From source: the API is out-of-process. `SyncRpcChannel` spawns the Go binary, ASTs come only via project snapshots, and the install is ~31 MB. [Verified](https://www.npmjs.com/package/typescript)
- typescript-eslint is waiting for 7.1 (#12518 closed). WIP PR #12803 uses IPC, and maintainers expect it to be not significantly faster than TS 6 at first. The parser requires `typescript <6.1.0`. [Verified](https://github.com/typescript-eslint/typescript-eslint/issues/10940)

**Parsers**
- Babel 8.0.0 (2026-06-16) is ESM-only; Babel 7 gets security fixes only, until June 2027. [Verified](https://babeljs.io/blog/2026/06/16/8.0.0) The AST has breaking changes, for example `typeParameters`→`typeArguments`, `TSEnumBody` and `ImportExpression`. [Verified](https://babeljs.io/docs/v8-migration-api)
- Local run of `@babel/parser` 8.0.7 with `["typescript","jsx"]`. [Verified](https://www.npmjs.com/package/@babel/parser)
  - `className="p-4"` → `JSXAttribute{name: JSXIdentifier, value: StringLiteral{value:"p-4", extra.raw}}`.
  - `style={{color:"#ff0000", padding:12}}` → `JSXExpressionContainer → ObjectExpression → ObjectProperty{key: Identifier, value: StringLiteral | NumericLiteral}`.
  - Every node has `start`/`end` (UTF-16) and `loc{start,end:{line 1-based, column 0-based, index}, filename}`. The root adds `errors` (with `errorRecovery`) and `comments`.
  - The `estree` plugin yields `Literal`/`Property` instead.
- Gotchas (local): `accessor` throws unless `decoratorAutoAccessors` is enabled. On fatal syntax errors Babel throws, while oxc returns an empty program plus errors. [Verified](https://www.npmjs.com/package/@babel/parser)
- oxc-parser 0.153.0. [Verified](https://www.npmjs.com/package/oxc-parser)
  - It claims ESTree conformance, but `preserveParens` defaults to true and emits non-standard `ParenthesizedExpression` (observed).
  - It gives offsets only, plus `module.staticImports`.
  - It's 0.x with weekly minors and 19 native optional deps.
  - Locally: 1.4 ms vs Babel's 4.7 ms on 43 KB of TSX.
- SWC 1.16.13 isn't ESTree. Its spans are 1-based UTF-8 byte offsets (31 vs JS index 27 on non-ASCII, local). [Verified](https://www.npmjs.com/package/@swc/core)

**ESLint 10 as host**
- ESLint 10.12.0 is 77 packages (14 MB). With `@babel/eslint-parser` 8 it lints TSX without TypeScript, 116 packages total (local). [Verified](https://www.npmjs.com/package/@babel/eslint-parser)
- `overrideConfigFile:true` ignores the repo's own config. `ruleFilter`, `concurrency` and `applySuppressions` exist. [Verified](https://eslint.org/docs/latest/integrate/nodejs-api)
- `LintMessage` has no `data` field: report data survives only inside `message` (local). Atlassian works around it by embedding `@meta <<{{payload}}>>` in message text. [Verified](https://eslint.org/docs/latest/integrate/nodejs-api)
- Disable comments (local). [Verified](https://eslint.org/docs/latest/use/configure/configuration-files)
  - Suppressions record `{kind:"directive", justification}`, taking the text after `--`.
  - `noInlineConfig` ignores all directives and warns once per directive.
  - Otherwise a legacy blanket `/* eslint-disable */` silently disables custom rules.
- Bulk suppressions store a count per file and rule. When the count is exceeded, every violation in that file is reported (local). The Node API applies suppressions but can't create them. [Verified](https://eslint.org/docs/latest/use/suppressions)
- Oxlint's ESLint-compatible JS plugins are still alpha, with no custom parsers and no type-aware rules. [Verified](https://oxc.rs/docs/guide/usage/linter/js-plugins)

**CSS**
- Stylelint 17.16.0 is 116 packages (16 MB). `npm audit` reports a high-severity `braces` advisory (via `micromatch`) that covers all versions. npm's only "fix" is a downgrade to stylelint 7.7.0. [Verified](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- Rule behaviour, tested locally. [Verified](https://stylelint.io/user-guide/node-api)
  - `color-no-hex` also flags token definitions, `var()` fallbacks and shorthands.
  - `declaration-strict-value` 1.12.1 lets through any function (`rgb()`), raw `var()` fallbacks and unlisted shorthands.
  - `declaration-property-value-allowed-list` regexes the whole value, so `calc(var(--x)*2)` fails `/^var\(--/`.
  - `no-unknown-custom-properties` takes no options, only knows properties declared in the same file, and skips references that have a fallback.
  - Warnings carry only rule, text and position.
- postcss-value-parser parses `var(--a, #0f0)` into a `function` node containing `word`, `div` and `word` children, each with a `sourceIndex`. `decl.positionBy({index})` turns that into a line and column. Stylelint, Polaris, Primer and design-lint all use it. [Verified](https://github.com/TrySound/postcss-value-parser)

**Prior art** (read from source)
- Atlassian 16.13.6. [Verified](https://www.npmjs.com/package/@atlaskit/eslint-plugin-design-system)
  - Raw HTML gets one rule per element (`no-html-button`…), driven by tables like `input[type=submit|…]` and `*[role=button]`. A lowercase tag means intrinsic.
  - Spacing and shape match tokens by exact value; colors only get a blank `token('')`.
  - Motion uses the exact token, else the nearest.
  - Rules run inside an error boundary, because they "should NEVER throw".
- SLDS Linter 1.2.1 is an ESLint 9 CLI with SARIF output. [Verified](https://www.npmjs.com/package/@salesforce-ux/eslint-plugin-slds)
  - Nearest color uses chroma `deltaE ≤ 10`, limited to property-valid hooks and ranked by role, top 5.
  - `reduce-annotations` flags its own ignore annotations.
- Polaris 16.0.7 requires stylelint ≤15, so it can't run on 17. [Verified](https://www.npmjs.com/package/@shopify/stylelint-polaris)
  - It renames rules to `polaris/<category>/<rule>`.
  - `--p-*` values must be real tokens; local properties must use `--pc-`.
  - Disable comments must carry a description.
- Primer. [Verified](https://www.npmjs.com/package/@primer/stylelint-config) [Verified](https://www.npmjs.com/package/eslint-plugin-primer-react)
  - The stylelint config (13.6.0) needs stylelint 16; it imports a `.cjs` file that's missing in 17.
  - Spacing autofixes values within ±1px of a token.
  - Colors rejects raw values and variables in the wrong role (fg/bg/border).
  - The React plugin has no raw-HTML rule. It checks imports scope-aware and maps Button→button for jsx-a11y.
- @lapidist/design-lint 8.0.0 is a custom engine that pins `typescript` 6.0.3. [Verified](https://www.npmjs.com/package/@lapidist/design-lint)
  - `component-usage` substitutes components. It autofixes only self-closing tags, and only when the replacement is already in scope.
  - Findings carry a structured `suggest` field.
  - It has its own disable comments.
- Tailwind: `eslint-plugin-tailwindcss` 4.4.0 has `no-arbitrary-value`. [Verified](https://www.npmjs.com/package/eslint-plugin-tailwindcss) `better-tailwindcss` 4.9.0 has `no-unknown-classes`/`no-restricted-classes` and configurable callees. [Verified](https://www.npmjs.com/package/eslint-plugin-better-tailwindcss)

**Usage indexing**
- react-scanner 1.2.0 (last release 2024-10) pins typescript-estree 8.8.0 and TS 5.6.2. [Verified](https://github.com/moroshko/react-scanner)
  - It maps each local name to `{imported, moduleName}` per file.
  - On each `JSXOpeningElement` it resolves the first segment of `Foo.Bar` and matches `importedFrom` (string or RegExp) against the raw specifier.
  - Props are stored as literals or as `"(ExprType)"`.
- It probably misses barrels, path aliases and `const B = DS.Button`. [Inferred]
- Omlet CLI 2.3.0 is a native analyzer feeding a SaaS dashboard. It tracks exported components only, counting usage once per parent, and uploads only metadata. [Verified](https://www.npmjs.com/package/@omlet/cli) Its parser is unknown. [Unresolved]
- reviewdog's `-filter-mode added|diff_context|file|nofilter` is prior art for diff scoping. [Verified](https://github.com/reviewdog/reviewdog)

## Implications for Design Warden

1. **Parser: `@babel/parser` ^8**, with `["estree","typescript","jsx","decorators","decoratorAutoAccessors"]` and `errorRecovery`.
   - It's pure JS and semver-stable, gives line/column/offset/filename, and has no TS peer to conflict with TS 6/7.
   - Write rules against ESTree shapes so oxc or an ESLint adapter can be dropped in later.
   - A parse failure becomes a `parse-error` finding (fail closed).
   - Skip the TS 7.1 API until a rule needs types.
2. **Own engine, not ESLint.**
   - Findings carry `evidence` and a `fingerprint`.
   - Suppression is our own `design-warden-ignore-next-line <rule> -- <reason>`. The reason is mandatory and policy can ban it.
   - `eslint-disable` is ignored, and every suppression is reported.
   - Add an ESLint adapter only on demand.
3. **CSS: PostCSS + postcss-value-parser.**
   - Flag raw values outside token files.
   - Check every `var()`, fallbacks included, for existence and role.
   - Treat color functions as raw, and walk `calc()` as a tree.
4. **Suggestions.**
   - Exact match: offer a fix.
   - Otherwise up to 3 candidates (CIEDE2000 within role for colors, ±1px for dimensions), never autofixed.
5. **Raw HTML.** One `{element, attrs?, component, importFrom}` registry drives findings, a11y semantics and usage stats.
6. **Usage index.** Built in the same parse pass; path and barrel resolution come later.
7. **Diff scope.** `added|file|all`. A finding is "new" if its fingerprint (rule+file+evidence+enclosing component) is absent on base. Don't match on lines or counts.
8. **Tailwind v1.** Scan `className` and `cn`/`clsx`/`cva`, and flag arbitrary values that hold raw colors or lengths.

## Open questions

- Will TS 7.1 offer in-process parsing?
- How should CSS-in-JS template literals be handled? Not evaluated yet.
- Should the registry be built from DTCG, built CSS or Tailwind `@theme`? See `design-contracts.md`.
- How close is Babel's TSX parsing to tsc? Only smoke-tested.
- When will `braces` ship a fix?

## Sources

- [TS 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/): no API in 7.0.
- [TypeScript#64709](https://github.com/microsoft/TypeScript/issues/64709): 7.1 API plan.
- [typescript on npm](https://www.npmjs.com/package/typescript): dist-tags and exports.
- [typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518), [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940): TS 7 plan.
- [Babel 8 post](https://babeljs.io/blog/2026/06/16/8.0.0), [migration](https://babeljs.io/docs/v8-migration-api): breaking changes.
- [oxc-parser](https://www.npmjs.com/package/oxc-parser), [@swc/core](https://www.npmjs.com/package/@swc/core): alternatives.
- [ESLint Node API](https://eslint.org/docs/latest/integrate/nodejs-api), [config](https://eslint.org/docs/latest/use/configure/configuration-files), [suppressions](https://eslint.org/docs/latest/use/suppressions): host behaviour.
- [Oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins): alpha status.
- [Stylelint Node API](https://stylelint.io/user-guide/node-api), [strict-value](https://github.com/AndyOGo/stylelint-declaration-strict-value), [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): CSS linting.
- [postcss-value-parser](https://github.com/TrySound/postcss-value-parser): node model.
- [Atlassian token rule](https://atlassian.design/components/eslint-plugin-design-system/ensure-design-token-usage/usage): options.
- [react-scanner](https://github.com/moroshko/react-scanner): `src/scan.js`.
- [reviewdog](https://github.com/reviewdog/reviewdog): filter modes.
