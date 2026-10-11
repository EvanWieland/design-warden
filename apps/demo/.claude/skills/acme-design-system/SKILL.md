---
name: acme-design-system
description: The Acme Console design system (tokens, components, states and page patterns); use it when building or changing UI in apps/demo.
---

# Acme Console design system

Acme Console is the order-management UI in `apps/demo`. Screens are built from the components in
`src/design-system/` and styled only with the tokens in `src/design-system/tokens.css`.
Design Warden enforces the rules below in every pull request (`apps/demo/design-warden.policy.json`).

## Principles

1. **Compose, don't recreate.** Build screens from design-system components. If something is missing, compose existing components first; a new shared component goes through the design-system team.
2. **Tokens carry every value.** Colors, spacing, radii, control sizes, shadows and type come from semantic tokens. Hex colors and pixel spacing never appear outside `tokens.css`.
3. **Every state is designed.** Anything that shows data handles loading, empty and error, and the copy says what happened and what to do next.
4. **One primary action per view.** The main task is obvious; everything else is secondary or ghost.
5. **Accessible by default.** Labels, focus rings, landmarks and contrast come with the components. Don't work around them.

## Checklist

- [ ] No raw `<button>`, `<a>`, `<input>`, `<textarea>`, `<select>` or `<table>` outside `src/design-system/`.
- [ ] Colors are `var(--color-*)`. Margins, paddings and gaps are `var(--space-*)`, `0` or `auto`, preferably via `<Stack gap>`. No `--palette-*`, no inline `style`.
- [ ] Every component call meets its contract: `DataTable` has `status` and `emptyState`, `Badge` and `Alert` have a `tone`, fields have a `label`.
- [ ] Loading, empty, error, disabled and focus states work, and their copy follows the content guide.
- [ ] The page follows a documented pattern, or the pull request explains the new one.
- [ ] Changes to tokens or shared components are reviewed by @acme/design-system.

## Reference

- [foundations.md](foundations.md): tokens, color, spacing, typography
- [components.md](components.md): component catalog and prop contracts
- [states.md](states.md): loading, empty, error, disabled and focus
- [patterns.md](patterns.md): page patterns and how to introduce a new one
- [content.md](content.md): writing for interface states
- [governance.md](governance.md): changing tokens and shared components, exceptions

## Before you finish

Run the design check from the repository root and fix every blocking finding:

```sh
corepack pnpm design-warden check --policy apps/demo/design-warden.policy.json
```

Findings that ask for review do not block, but explain them in the pull request.
