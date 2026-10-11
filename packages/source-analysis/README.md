# @design-warden/source-analysis

Part of [Design Warden](https://www.npmjs.com/package/design-warden), which checks frontend pull requests against a design-system policy. Install `design-warden` for the command line; you rarely need this package directly.

This package holds the deterministic source checks for TSX and JS/JSX, CSS and SCSS, Vue and Svelte components, Tailwind classes and CSS-in-JS (templates, object styles, MUI `sx`): literal colors, off-scale spacing and font sizes, token usage, `!important`, raw controls, component prop contracts, duplicated components, pattern provenance and shared-change impact. Checks return findings; they never decide outcomes.

MIT licensed.
