# ADR 0003: Babel 8 and PostCSS in our own engine, not ESLint or Stylelint plugins

Status: Accepted, 2026-10-10

## Context

The checks need real parsers for TSX and CSS, structured evidence per finding, explicit exception semantics, and change-scoped reporting. Facts verified on 2026-10-10 ([static-analysis-and-tokens.md](../research/static-analysis-and-tokens.md)):

- `typescript@7.0.2` exports no stable JS compiler API. Its unstable API spawns the Go binary.
- typescript-eslint requires `typescript <6.1`.
- Babel 8 (`@babel/parser` 8.0.7) is pure JS and works without TypeScript.
- ESLint discards rule `data` in results. A blanket `eslint-disable` silences custom rules. Bulk suppressions are per-file counts.
- Stylelint 17 brings 116 transitive packages and an open advisory. Its `color-no-hex` flags token definitions.

## Decision

- TSX/TS: `@babel/parser` with the `typescript` and `jsx` plugins (`.js`/`.jsx` with `jsx` only, added later), and a 20-line generic AST walker. Parse errors become `analysis/unparseable-file` findings (review), never a silent pass.
- CSS: `postcss` plus `postcss-value-parser`. Plain CSS at first; SCSS and CSS-in-JS templates were added later with `postcss-scss` (no dependencies, no install scripts), which produces the same PostCSS tree. Vue and Svelte were added later through adapters (`templates.ts`): `@vue/compiler-dom` (SFC mode, without `@vue/compiler-sfc` and its extra packages) and `svelte/compiler`, both loaded only when such a file is parsed.
- Checks are small modules (`defineCheck({ id, options: zodSchema, runFile | runProject })`) that return `FindingDraft`s. They never print and never decide outcomes.
- We borrow algorithms from existing tools rather than depending on them: nearest token from SLDS, scale snapping from Primer, element and attribute tables from Atlassian.

## Consequences

- Full control over evidence, exceptions and scoping. The parsing footprint stays small: `@babel/parser`, `postcss`, `postcss-value-parser` and `postcss-scss`, plus the Vue and Svelte compilers, which load only for their files.
- No editor squiggles yet. An ESLint adapter that wraps the same check functions is the extension path.
- Rule code is written against Babel's AST shapes (`StringLiteral`, `ObjectProperty`). Moving to oxc would need a small adapter; Babel's `estree` plugin was considered and not used, because the parser touch points are few.
- Not covered at first: CSS-in-JS, SCSS and Tailwind classes. Tailwind arbitrary values, CSS-in-JS templates and SCSS were added later; Tailwind theme classes are still not read (that needs the Tailwind config). [rules.md](../rules.md) lists what each reader cannot see.

## Alternatives considered

- **TypeScript 6 compiler API:** a frozen line, 23 MB, and no type information is needed for these checks.
- **oxc-parser:** fast, but 0.x with weekly releases and native binaries.
- **ESLint and Stylelint as hosts:** rejected for the reasons above.
