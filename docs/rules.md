# Built-in checks

A policy rule selects one of these with `"verify": { "by": "check", "check": "<id>", "options": {…} }`. Options are validated when the policy loads. `design-warden checks` lists them. Precision and recall per demo rule are in [evaluation.md](evaluation.md).

Common behaviour:
- Files are parsed with Babel 8 (TS/TSX, and JS/JSX without TypeScript syntax), PostCSS (CSS), postcss-scss (SCSS), and the Vue and Svelte compilers ([below](#vue-and-svelte-components)). A file that cannot be parsed produces `analysis/unparseable-file` (review) instead of passing silently.
- Token source files are never reported as using literal values. They define them.
- With `--base`, per-file checks only run on changed files, and findings outside the changed lines are pre-existing.

### Tailwind classes

The style checks (`no-hardcoded-color`, `spacing-scale`, `token-usage`) also read Tailwind classes with **arbitrary values**, as the CSS they produce. Findings point at the class: "`13px` in class `p-[13px]` is not on the `--space-*` scale".

- **Where:** literal `className` strings (also in `{…}`, every branch of `?:`/`&&`/`??`, and the static parts of template literals), the arguments of `clsx`, `cn`, `classnames`, `classNames`, `cx`, `twMerge` and `twJoin` (strings, arrays and object keys), and same-file `const` strings used as classes (`className={base}`, reported where the constant is written), in TS/TSX/JS files and in Vue and Svelte class attributes.
- **What:** `p-[13px]` (padding), `text-[#e11d48]` (color), `text-[15px]` (font size), `bg-[…]`, `border-[…]`, `shadow-[0_1px_2px_#000]`, gap, margin and the other spacing and color utilities, arbitrary properties (`[padding:13px]`) and the v4 variable shorthand (`p-(--space-3)` is `var(--space-3)`). Variants (`md:hover:`, `data-[state=open]:`), negative values (`-mt-[8px]`), opacity (`/50`), the `!` modifier and type hints (`text-[length:…]`) are understood.
- **Allowed:** values that use tokens, such as `p-[var(--space-3)]`.
- **Default-palette color classes** (`bg-red-500`, `hover:text-white`, `border-t-slate-200/50`, `ring-offset-blue-600`) are read as the theme variable Tailwind v4 compiles them to, `var(--color-red-500)`, and `token-usage` judges that reference like any other: "Class `bg-red-500` uses `--color-red-500`, which is not a defined design token". If the token sources define the palette as internal tokens, the finding names the semantic class with the same value ("Use `hover:text-danger` (var(--color-danger))"). A project that uses the default palette on purpose lists Tailwind's theme file (`node_modules/tailwindcss/theme.css`, whose `@theme` block is read) as a token source with an allowed `--color-` prefix.
- **Not judged:** other theme classes such as `p-4`, `text-sm` or `bg-primary`. Sizes and keywords are not colors, and a project's own color names are its tokens. Whether a spacing class matches the design system depends on the project's Tailwind config, which Design Warden does not read.
- **Not read:** class strings built at runtime, helpers called as members (`utils.cn(…)`), the v3.3 `[--var]` shorthand (`bg-[--x]`; the v4 `(--x)` form is read), `cva()` variant definitions, `@apply` in CSS, and the `!` modifier as `!important`.

### CSS-in-JS templates

The same style checks read the CSS in tagged templates of styled-components and Emotion: `styled.div`, `styled(Button)`, `styled.div.attrs(…)`, `css`, `createGlobalStyle`, `keyframes` and `injectGlobal`. Templates are parsed with PostCSS, and findings point at the declaration's line and column in the file.

- **Interpolations:** a declaration whose value contains `${…}` is computed at runtime. It is **insufficient evidence** for the checks that cover that property ("`color` is computed from `${(p) => p.tone}`"). This includes theme lookups such as `${(p) => p.theme.colors.primary}`, the same as a computed inline style. Codebases that take every color from the theme get a review request per such declaration.
- A `${…}` standing alone (a mixin such as `${focusRing}`, also when a `//` comment or another mixin follows it) or in a selector (`${Link}:hover &`) is skipped; a nested `css` template is analysed where it is defined. A `${…}` as the property (`${side}: 4px`) is insufficient evidence ("sets a property chosen at runtime").
- Templates are parsed with postcss-scss, so `//` line comments and nesting, as stylis allows them, are fine.
- **A template that cannot be parsed**, for example with an unmatched brace, is reported as insufficient evidence once per style rule, instead of passing unread.
- **Not read:** other tags (`gql`, `sql`), `styled` or `css` imported under another name (`emStyled.div`), and helper templates such as `` ${media.md`…`} ``. An interpolation is insufficient evidence even when every branch is a literal (`${(p) => (p.big ? '15px' : '14px')}`), and one that returns CSS text (`${(p) => p.danger && 'color: #dc2626;'}`) is taken for a mixin and not read.

### CSS-in-JS object styles

Object styles are read like inline style objects: `css({…})`, `styled.div({…})`, `styled(Button)({…})`, `styled('p')(…)`, `styled.div.attrs(…)({…})`, `keyframes({…})` and Emotion's `css` prop. Keys are camelCase CSS properties, and numbers are pixels, as in React and Emotion.

- **Nested objects** (selectors such as `'&:hover'`, media queries, keyframe steps) are read like the top level.
- **Functions** passed to a style call (`styled.p((p) => ({ … }))`) are read through what they return: the concise body, or each `return` in the function's body.
- **Computed values** (`color: p.tone`, theme lookups) are **insufficient evidence** for the checks that cover the property, as for template interpolations. A spread of an object built elsewhere is insufficient evidence for every style check; a same-file constant is read.
- **MUI's `sx` prop** is theme-aware, so only literal raw CSS is reported: a string that is not a theme path. Numbers (`p: 2`, theme spacing units), theme paths (`'primary.main'`, `'grey.500'`) and computed values are theme lookups. They are not insufficient evidence either: `sx` exists to read the theme. Shorthands (`p`, `px`, `mt`, `bgcolor`, …) are read as the CSS properties they set. Responsive arrays (`px: [1, '10px']`) and breakpoint or selector objects are read value by value. A keyword that is not a color (`borderColor: 'divider'`) is not reported.
- **Not read:** `.attrs({…})` arguments (component props, not styles), other functions (`track({ color: 'red' })`), Emotion's `<Global styles={…}>`, JSS (`makeStyles`), React Native's `StyleSheet.create`, and style functions imported under another name.

### Vue and Svelte components

`.vue` single-file components (parsed with `@vue/compiler-dom`) and `.svelte` components (`svelte/compiler`) are read by every check. Add the extensions to `project.include` (for example `src/**/*.{ts,tsx,css,vue,svelte}`).

- **Markup:** each element becomes a usage, like a JSX element. Component tags are resolved through the script's imports, so `designSystem.importSources` applies, also through a namespace import (`<DS.Badge>` with `import * as DS`). A Vue tag without a local import resolves against **global registrations** anywhere in the project: `app.component('AcmeBadge', Badge)`, `Vue.component(…)` and chained `createApp(App).component(…)`, where the component is an import of the registering file. Both spellings match (`<acme-badge>`, `<AcmeBadge>`), the design-system name is the registered import's (`Badge`), and a local import wins, as in Vue. Other unimported tags are local components. Vue kebab-case attributes on components map to camelCase props (`empty-state` is `emptyState`). Vue's same-name shorthand (`:tone` is `:tone="tone"`) and Svelte 5 snippets declared inside a component (`{#snippet emptyState()}`) count as props.
- **Attribute values:** static values are string literals and bound values (`:prop="…"`, `v-model`, `{expr}`, `bind:prop={…}`) are parsed expressions, so `raw-element`, `component-props` (including spreads such as `v-bind="obj"` and `{...props}`) and the style checks treat them as they treat JSX.
- **Styles:** `style="…"` is read as an inline style (in Svelte, declarations with `{…}` parts are insufficient evidence and the rest are checked); `:style="{…}"` and Svelte's `style:prop={…}` as style objects; `class`, `:class` and `class:name={…}` as class strings (Tailwind); `<style>` blocks (CSS or SCSS) as stylesheets.
- **The component** is named after the file and spans the markup, for provenance and duplicate detection.
- **Directives:** `<!-- design-warden-ignore-next-line <rule> -- <reason> -->` in markup, and the usual comments in script and style.
- **Not read:** render functions and JSX in `<script>`, components registered by a plugin (`app.use(AcmeDesignSystem)`) or renamed in an Options API `components: { Alias: Badge }` map, and `v-bind()` in Vue `<style>` (`color: v-bind(accent)` is not judged). Vue array styles (`:style="[base, { gap: '10px' }]"`) are insufficient evidence. A required prop passed as a Vue named slot (`<template #empty-state>`) is reported as missing, because slots are not props. `<style lang="postcss">` is reported as unparseable, like other style languages. Markup in another language (`<template lang="pug">`, `<style lang="less">`) or loaded from another file (`<template src>`, `<script src>`, `<style src>`) makes the file unparseable (review) instead of passing unread.
- The compilers are loaded only when such a file is parsed.

### SCSS

`.scss` files are parsed with postcss-scss and checked like CSS: literal colors, lengths and token references, and `!important`. Add `scss` to `project.include` (for example `src/**/*.{ts,tsx,css,scss}`).

- **Variables:** a value that uses a `$variable` or `#{…}` interpolation is resolved only by the Sass compiler, so it is **insufficient evidence** for the checks that cover that property ("`margin` is computed from `$gap`"). This includes functions such as `darken($brand, 10%)`.
- A variable defined with a literal (`$brand: #db2777;`) is checked like a custom property outside the token sources. A variable built from other variables is judged where it is used.
- **Mixins:** `@include name(arguments)` without a content block is insufficient evidence once per style rule, because only the mixin's definition shows what it sets; that definition is checked where it lives. An `@include` without arguments (with or without empty parentheses), or with a content block (`@include breakpoint(md) { … }`, whose block is checked), is not reported.
- **Not read:** property names built with `#{…}`, `@extend`, and token sources written as Sass variables (use CSS custom properties or DTCG).

## Source checks

### `no-hardcoded-color`

Reports literal colors: hex, `rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color()`, and named colors in color-related properties. It looks in:
- CSS declarations, including custom properties defined outside the token sources and `var()` fallbacks;
- inline `style={{…}}` objects, also behind a type cast (`{…} as CSSProperties`) or defined as a constant object in the same file (`style={cell}`; reported where the constant is defined);
- color-like JSX props (`color`, `fill`, `stroke`, `background…`), for example `<path fill="#000">`.

Every literal branch of a conditional or fallback (`?:`, `??`, `||`, `&&`) is checked.

- **Insufficient evidence:** an inline style color computed at runtime (`style={{ borderColor: accent }}`, a string constant), or a style object built elsewhere (`style={BY_STATUS[s]}`). A runtime value in a color prop is not reported.
- **Suggestion:** the nearest allowed token by perceptual distance (OKLab).
  - An exact value match is preferred.
  - Otherwise, the closest token named for the property's role (`text` for `color`, `bg` for `background`, `border` for borders).
  - No suggestion when nothing is close, for translucent colors (no opaque token equals them), or when the declaration redefines that token.
- **Options:** `allow` (default `transparent`, `currentcolor`, `inherit`, `initial`, `unset`, `none`); `tokenPrefix` (default `--color-`).
- **Not detected here:** Tailwind default-palette classes (`text-red-500`) are token references, judged by `token-usage` (see above). CSS-in-JS templates and object styles, SCSS and Tailwind arbitrary values are read.

### `spacing-scale`

Reports literals in the configured units (default `px`, `rem` and `em`) in margins, paddings and gaps (including logical properties and inside `calc()`), plus React numeric styles (`padding: 12` = 12px, checked when `px` is a configured unit). Inline styles are read as for colors: casts, same-file constant objects and every literal branch.

- `0`, `auto` and percentages are allowed. Unitless numbers in `calc()` are multipliers or divisors (`calc(var(--space-3) * -1)`), not lengths, and are allowed.
- A hardcoded fallback in `var(--space-4, 16px)` is reported, with the suggestion to remove it when the token is defined.
- Insufficient evidence for computed inline values and style objects built elsewhere.
- **Suggestion:** the nearest `--space-*` step, or nothing if no step is within 25% (min 4px). A value equal to a step is reported as "is hardcoded; the `--space-*` scale has a token for it".
- **Options:** `properties`, `allow`, `tokenPrefix` (default `--space-`), `units` (any of `px`, `rem`, `em`; default all three). Messages name the scale by its prefix. Suggestions convert `rem` and `em` at 16px.
- **Other length scales:** point the same check at other properties. The demo's `typography/scale` rule checks font sizes:

  ```json
  "verify": { "by": "check", "check": "spacing-scale", "options": { "properties": ["font-size"], "tokenPrefix": "--font-size-", "units": ["px", "rem"] } }
  ```

  `em` is left out because a font size in `em` is relative to the parent's, so it is not a step on a fixed scale. Not detected for font sizes: the `font` shorthand (a known false negative in the benchmark), `em`, `pt` and other units, and keywords such as `small`.

### `token-usage`

Every `var(--x)` must be a token defined in the token sources with an allowed prefix, or a custom property defined in the same file. A token redefined outside the token sources (`.x { --color-text-primary: #111827; }`) is a violation.

- Primitive tokens (for example `--palette-*`) are reported with the semantic tokens that resolve to the same value.
- Unknown tokens get a "did you mean" suggestion (edit distance ≤ 3).
- A Tailwind default-palette class is reported as the token it references, naming the class. A suggestion names the replacement class too, keeping its variants and opacity (`hover:text-danger/80`).
- Deprecated tokens (DTCG `$deprecated`, see [policy-authoring.md](policy-authoring.md#token-sources)) are reported with their reason. Suggestions in every check skip deprecated tokens.

### `no-important`

Reports CSS declarations marked `!important` in any spelling (`! IMPORTANT`), including custom properties and declarations inside `@media` or `@supports`, in every CSS source: `.css` and `.scss` files, Vue and Svelte `<style>` blocks, static `style="…"` attributes (TSX, JS, Vue, Svelte) and CSS-in-JS templates. One finding per declaration, on the line where it starts (`endLine` covers multi-line declarations).

- `!important` inside a comment, a string (`content: "!important"`) or a `url()` is not a declaration flag and is not reported.
- The check skips no files itself. Exclude the design system and the token sources with the rule's `scope.exclude`; in the demo, `src/design-system/**` covers both.
- **Verdict:** `violation` (deterministic). There is no insufficient-evidence case: the flag is syntax.
- **Suggestion:** remove `!important`; if the declaration then loses, use the component's variant or fix the selector's specificity or order.
- **Options:** none.
- **Not detected:** the Tailwind `!` modifier (`!p-4`), and `!important` inside style object values (`style={{ color: 'red !important' }}`, which React does not apply anyway).
- **Known false positives:** none in the benchmark. A deliberate override of third-party CSS is still reported; give it a policy exception.

### `raw-element`

Reports raw HTML elements, and ARIA-role imitations, that a registry component `replaces`.
- `replaces` entries are selectors: `tag`, `tag[attr=value]` or `[attr=value]`. In the demo, `Button` replaces `button` and `[role=button]`; `Checkbox` replaces `input[type=checkbox]` and `[role=checkbox]`; `TextField` replaces `input` and `textarea`.
- The most specific selector wins. So `<div role="button">` is reported as "imitates a control; use `<Button>`".
- A bare `input` selector matches only text-like inputs: no `type`, or `text`, `email`, `search`, `number`, `tel`, `url`, `password`. `type="hidden"` is never reported. A computed `type={…}` is insufficient evidence.
- Use the rule's `scope.exclude` for the design system itself.
- **Options:** `elements` (restrict to a subset).

### `component-props`

Checks call sites of design-system components against the registry's prop contracts.

- Components are resolved through imports from the policy's `importSources`, including aliased (`import { Badge as Tag }`) and namespace (`DS.Badge`) imports, in JSX and in Vue and Svelte markup.
- A missing required prop is a violation, or insufficient evidence when spread props could supply it.
- A literal value outside `allowed` is a violation. For conditionals, each literal branch is checked. Runtime values are not judged.
- **Options:** `components` (restrict).

### `duplicate-component` (heuristic)

Reports a component defined outside the design system whose name ends in a registered component's name or alias (its head noun), and that does not render that component.
- Example: `StatusPill` ends in Badge's alias `pill`; a `PaidBadge` that renders `<Badge>` is fine; `NoticeBoard` is not matched, because its head noun is "board".
- Verdict `probable-violation`, origin `heuristic`, so at most review.
- **Known false positives:** names whose head noun is an alias by coincidence (`PivotTable` matches DataTable's alias `table`); see the benchmark.

### `pattern-provenance` (heuristic, needs `--base`)

Classifies each changed component definition (PascalCase function rendering JSX):

| Class | When |
|---|---|
| `established` | Existing component with unchanged structure, or a new one that matches a reference pattern or existing component (similarity ≥ `establishedThreshold`, 0.6) |
| `modified` | Existing component whose structure changed, or partial match (≥ `modifiedThreshold`, 0.3) |
| `novel` | No close precedent |
| `insufficient-evidence` | Fewer than `minElements` (3) elements, or structure mostly dynamic (spread props, computed tags, `createElement`) |

- **Similarity** needs two signals to agree, and the lower one counts:
  - composition: Jaccard over the set of rendered design-system components, local components and semantic HTML elements;
  - shape: Zhang-Shasha tree edit distance over how those elements nest, as 1 − edits / size of the larger tree.
  So the same components in a different layout, or a rearranged existing component, are not `established`.
- Structureless `div`, `span` and `p` are ignored in both signals (their children move up), and adjacent identical subtrees count once, so a wrapper or one more control of the same kind does not change the shape. Props are ignored.
- Trees over 300 nodes are compared by composition only, because the edit distance's cost grows with the product of the tree sizes. For such large components a layout change alone is not seen.
- A reference pattern whose file is changed in the same change set is read as it was in the base, so editing a reference cannot vouch for new code; a reference file added by the change is not used.
- Records always appear in the report.
- **Options:** `novel`, `modified`, `insufficientEvidence`, each `review` / `notice` / `off` (defaults `review` / `notice` / `notice`), plus the thresholds above.
- A `review` class becomes an `insufficient-evidence` finding ("confirm it is justified"); `notice` becomes informational.
- Findings cover the component's whole line span, so a change anywhere inside it counts.

### `shared-change` (needs `--base`)

For changed files in the rule's scope (the design system):
- **Token files:** compares *resolved* values of base and head, so changing a primitive reports every semantic token built on it. Each changed token is listed with before and after values and its `var()` usages across the project. Removed tokens that are still used are called out.
- **Component files:** maps the file to registry components (same source, or a sibling with the same base name, such as `Button.css` → `Button.tsx`) and lists their JSX usages.

Verdict `violation` of a rule that normally uses `enforcement: "review"`: the change is real and needs owner review, not a failure. **Options:** `maxUsagesListed` (25).

## Visual checks

### `visual-diff`

Compares base and head capture directories (`--visual-base` / `--visual-head`, produced by `design-warden capture`). Refuses to compare captures from different environments (Playwright version, browser, headless mode, platform, scale).

- pixelmatch 8 at threshold 0.02: the default 0.1 misses adjacent token shades.
- Changed pixels are clustered on an 8 px grid into regions (≥4 px per cell, ≥24 px per region). Each region is labelled with the smallest captured element containing it.
- One finding per route/state with changes: verdict `insufficient-evidence` ("changed; confirm it is intended"), with before/after/diff images. A difference is never reported as a violation.
- States that failed to capture produce `insufficient-evidence`; added or removed states produce `notice`.
- **Options:** `threshold`, `cellSize`, `minCellPixels`, `minRegionPixels`.

### `accessibility`

Runs [axe-core](https://github.com/dequelabs/axe-core) on every captured state and reports violations that are **new in head**: elements the base capture did not have for that axe rule. Elements are matched by their HTML and counted, so a violation that only moved is not new and a second identical one is; axe's own selectors use positions (`nth-child`), which shift when unrelated markup changes. `design-warden capture` runs axe only when the policy has a rule with this check; the script is read from `node_modules` and evaluated in the page, so it makes no network request, and the screenshot is taken first.

- One finding per axe rule and state: "color-contrast (serious) on overview/default (desktop): … New on 2 element(s): `.badge`, `.btn`", with the rule's help link as evidence.
- **Verdict:** `probable-violation`. Automated results need a human in context, so this check can request review at most, whatever the rule's category.
- A state axe could not check is `insufficient-evidence`; a state that failed to capture is reported by `visual-diff`.
- Results are compared only when both capture directories come from the same environment (as for `visual-diff`; otherwise the visual engine fails) and were checked with the same axe-core version and tags. A different version or tags, or captures made without axe, give one `insufficient-evidence` finding that says so instead of a comparison.
- **Options:** `tags`, the axe rule tags to run (default WCAG 2.0, 2.1 and 2.2 levels A and AA: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`).
- **Not detected:** what automated testing cannot see (axe finds a part of WCAG issues; meaning, reading order and keyboard flow need people), states that are not captured, and violations that already existed in base.
- axe-core 4.14.0 is licensed MPL-2.0; it is used unmodified.

## Built-in governance rules (always on)

| Rule | When | Outcome |
|---|---|---|
| `policy/changed` | The change set modifies the policy file; evidence lists rule-level changes and flags weakening | review |
| `policy/exception-expired` | A policy exception is past its `expires` date | review |
| `policy/inline-exception-rejected` | An inline exception without a rule or reason, naming an unknown rule, or for a rule that forbids inline exceptions | review |
| `analysis/unparseable-file` | A file in scope could not be parsed | review |
| `semantic/advisory` | A verified model observation not tied to a policy rule | info |
