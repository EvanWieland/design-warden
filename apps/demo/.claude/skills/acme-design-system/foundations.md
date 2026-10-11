# Foundations

## Tokens

All visual values live in `src/design-system/tokens.css`, in two tiers:

| Tier | Prefix | Who may use it |
| --- | --- | --- |
| Primitives | `--palette-*` | Only `tokens.css`. Raw values with no meaning. |
| Semantic tokens | `--color-*`, `--space-*`, `--radius-*`, `--size-*`, `--shadow-*`, `--font-*`, `--line-height-*`, `--border-width-*` | Everyone. Named for their purpose. |

- Code MUST reference semantic tokens with `var(--token)` and MUST NOT reference `--palette-*`.
- Colors, spacing, radii, control heights, border widths, shadows and type MUST use their tokens. Layout limits that have no token, such as a form's maximum width, MAY use a rem value.
- Every `var()` MUST name a token that exists. A misspelled token silently renders nothing.
- Pick a token for its purpose, not its value: `--color-bg-subtle` and `--color-action-disabled-bg` are the same gray today, but only one of them means "disabled".
- If no token fits, ask @acme/design-system for one (see governance.md). Don't add a local value.

Shape, size and elevation:

| Token | Use |
| --- | --- |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | Small marks; controls and alerts; cards; badges and round shapes |
| `--size-control-sm`, `--size-control-md` | Height of small and regular controls |
| `--size-sidebar`, `--size-content-max` | App shell sidebar width; maximum width of `<main>` |
| `--border-width-default` | Every border and the focus outline |
| `--shadow-card`, `--shadow-focus` | Cards and stat cards; the focus halo |

## Color

| Purpose | Tokens |
| --- | --- |
| Page and surfaces | `--color-bg-canvas` (page), `--color-bg-surface` (cards, sidebar, inputs), `--color-bg-subtle` (hover), `--color-bg-selected` (current navigation item) |
| Borders | `--color-border-default` (cards, dividers), `--color-border-strong` (inputs, secondary buttons, table headers) |
| Text | `--color-text-primary`, `--color-text-secondary` (descriptions, hints), `--color-text-muted` (placeholders), `--color-text-inverse` (on primary and danger fills), `--color-text-link`, `--color-text-danger` (field errors) |
| Actions | `--color-action-primary`, `--color-action-secondary-bg`, `--color-action-danger`, each with a `-hover` token; `--color-action-disabled-bg` and `--color-action-disabled-text` |
| Status | `--color-status-{neutral,info,success,warning,danger}-bg` with the matching `-fg` |
| Focus | `--color-focus-ring` |

- Every color MUST be a `var(--color-*)` token. The only keywords allowed are `transparent`, `currentColor` and `inherit`.
- Hex, `rgb()`, `hsl()` and named colors MUST NOT appear in CSS, inline styles or color props such as `color`, `fill` or `background`.
- Status colors come in pairs: use a `-bg` token with its own `-fg` token. Prefer `<Badge>` and `<Alert>` over styling status yourself.
- Color MUST NOT be the only signal: pair it with text, such as a Badge label or an error message.
- Text tokens meet WCAG AA (4.5:1) on `--color-bg-surface` and `--color-bg-canvas`; `--color-text-inverse` meets it on the primary and danger action fills. Status `-fg` tokens meet it on their `-bg` partner.

## Spacing

A 4px scale. Use the step, not the pixel value.

| Token | Value | Typical use |
| --- | --- | --- |
| `--space-0` | 0 | Reset |
| `--space-1` | 4px | Label to field, inside badges |
| `--space-2` | 8px | Icon to text, tight groups |
| `--space-3` | 12px | Table cells, button groups |
| `--space-4` | 16px | Related items, stat card rows, mobile page padding |
| `--space-5` | 24px | Fields in a form, card padding |
| `--space-6` | 32px | Page sections, desktop page padding |
| `--space-7` | 48px | Around empty and loading states |

- `margin*`, `padding*` and `gap*` MUST use `var(--space-*)`, `0` or `auto`. No px, rem or em literals and no negative margins.
- Space between sibling components SHOULD come from `<Stack gap={n}>`, where `n` is the step (`gap={5}` is `--space-5`), not from margins on the children.
- Pages are a `<Stack gap={6}>` of sections. Forms are a `<Stack gap={5}>` of fields.

## Typography

The base font is `--font-family-base`, the system UI stack; we do not load web fonts. `--font-family-mono` is for code and identifiers.

| Use | Size | Weight | Line height |
| --- | --- | --- | --- |
| Page title (PageHeader), stat value | `--font-size-2xl` | `--font-weight-semibold` | `--line-height-tight` |
| Card title, empty-state title | `--font-size-lg` | `--font-weight-semibold` | `--line-height-tight` |
| Body, controls, table cells | `--font-size-md` | `--font-weight-regular` | `--line-height-base` |
| Hints, errors, table headers, small buttons | `--font-size-sm` | regular to semibold | `--line-height-base` |
| Badges | `--font-size-xs` | `--font-weight-medium` | `--line-height-base` |

- Font sizes, weights and line heights MUST use the `--font-*` and `--line-height-*` tokens.
- Each page has exactly one `<h1>`, rendered by `PageHeader`. Card titles and empty-state titles are `<h2>`.
- Use sentence case for titles, labels and buttons: "New order", not "New Order".
