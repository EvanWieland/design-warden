# Components

Import components from the design-system entry point, for example `import { Button } from '../design-system';`.
The required props and allowed values below are the component registry in `design-warden.policy.json`; Design Warden checks every call site against them.

- Outside `src/design-system/`, raw `<button>`, `<a>`, `<input>`, `<textarea>`, `<select>` and `<table>` MUST NOT be rendered. Use the component that replaces them.
- A new component MUST NOT be named after an existing component or its aliases (for example `StatusPill`, `InfoBanner`, `OrdersTable`) unless it renders that component.
- Props with allowed values SHOULD be written as literals so they can be checked: `<Stack gap={4}>`, not `<Stack gap={size}>`. When the value depends on data, map it through a typed lookup such as `orderStatuses[order.status].tone`.

## Button

Replaces `<button>`. Aliases: btn, CTA.

- `variant`: `primary`, `secondary` (default), `danger` or `ghost`.
- `size`: `sm` or `md` (default).
- `loading`: shows a Spinner, sets `aria-busy` and blocks repeat clicks.
- `disabled`, `type` (`button` by default, `submit` in forms), `onClick`, `children`.

Do: keep one `primary` per view; use `ghost` for Cancel and Reset; use `danger` only for destructive actions.
Don't: style another element as a button; pass colors or sizes.

## Link

Replaces `<a>`.

- `to` (required in code): an app path such as `/orders`. Plain left-clicks navigate in the app; modified clicks open a new tab as usual.
- `variant`: `default` (underlined) or `nav` (AppShell navigation; sets `aria-current="page"` on the current section).
- `children`: text that names the destination.

Do: write "View all orders". Don't: write "Click here", or use a Link for an action that changes data.

## TextField

Replaces `<input>` and `<textarea>`.

- `label` (**required**): always visible.
- `name`, `value`, `onChange(value: string)`, `type` (`text`, `number`, `email`, `search`), `placeholder`, `required`, `disabled`.
- `hint`: help text under the field. `error`: message under the field; sets `aria-invalid="true"`. Both are linked with `aria-describedby`.
- `multiline`: renders a textarea.

Do: put format help in `hint`; validate on submit and pass the message as `error`.
Don't: use a placeholder instead of a label; hide the label.

## Select

Replaces `<select>`.

- `label` (**required**), `value`, `onChange(value)`, `options` (`{ value, label }[]`), `hint`, `error`, `required`, `disabled`.

Do: start a required Select with a "Choose a …" option whose value is `''`.
Don't: build a custom dropdown; the native control is accessible on every device.

## Checkbox

- `label` (**required**), `checked`, `onChange(checked: boolean)`, `hint`, `disabled`.

Do: phrase the label as what becomes true ("Send weekly summary"); explain a disabled checkbox in `hint`.
Don't: use a Checkbox to trigger an immediate action.

## Badge

Aliases: pill, chip, tag, status label.

- `tone` (**required**): `neutral`, `info`, `success`, `warning` or `danger`.
- `children`: one or two words.

Order status tones: pending is `warning`, paid is `info`, shipped is `success`, refunded is `neutral`.

Do: always include text. Don't: make a Badge clickable, or invent tones and colors.

## Card

Alias: panel.

- `title`: renders an `<h2>`. `actions`: shown at the end of the header, such as a Link to the full list. `children`.

Do: one topic per card. Don't: nest cards.

## Stack

- `gap`: `0` to `7`, a step on the spacing scale (`gap={4}` is `--space-4`).
- `direction`: `row` or `column` (default).
- `align` (`start`, `center`, `end`, `stretch`, `baseline`), `justify` (`start`, `center`, `end`, `between`), `wrap`.

Do: use Stack for all space between siblings. Don't: add margins to children or pass pixel values.

## PageHeader

- `title` (**required**): the page's only `<h1>`.
- `description`: one sentence of context.
- `actions`: at most one primary Button.

## DataTable

Replaces `<table>`. Alias: table.

- `status` (**required**): `loading`, `error` or `ready`.
- `emptyState` (**required**): rendered when `status` is `ready` and there are no rows; usually an EmptyState.
- `columns` (`{ key, header, align?, render? }[]`), `rows`, `rowKey(row)`.
- `caption`: names the table for screen readers; visually hidden.
- `errorMessage` and `onRetry`: shown in the error Alert; `onRetry` adds a "Try again" button.

Do: right-align money (`align: 'right'`); show status with a Badge.
Don't: render a DataTable without `status` and `emptyState`; the missing state becomes a blank area.

## EmptyState

- `title` (**required**), `description`, `action`.

Do: say what is empty and how to change that (see content.md). Don't: show table headers with no rows.

## Alert

Aliases: banner, callout, notice.

- `tone` (**required**): `info`, `success`, `warning` or `danger`. Danger renders `role="alert"`; the others render `role="status"`.
- `title`, `children`, `action`.

Do: use `danger` for errors that block the task, `success` to confirm, `warning` for risk, `info` for context.
Don't: stack several alerts, or use an Alert for permanent help text.

## StatCard

Aliases: KPI, metric card.

- `label` (**required**), `value` (pre-formatted), `change` (pre-formatted, such as `+6.4%`), `trend` (`up`, `down`, `flat`).
- The trend Badge shows direction, not judgement: `up` and `down` are `info`, `flat` is `neutral`. A falling number can be good news.

Do: place up to four in a `<Stack direction="row" gap={4} wrap>`. Don't: use a StatCard to report a problem; use an Alert.

## FilterBar

Alias: toolbar.

- `children`: TextField and Select filters.
- `onReset`: adds a ghost "Reset" button.

Renders `role="search"`. Filters apply as the user types; there is no Apply button.

## Spinner

Alias: loader.

- `label` (**required**): screen-reader text, such as "Loading orders".
- `size`: `sm` or `md` (default).

Do: place it in a `role="status"` region; DataTable does this for you. In a Button, use `loading` instead. The spinner slows down under `prefers-reduced-motion`.

## AppShell

- `nav`: `{ to, label }[]`. `children`: the current page.

Provides the sidebar with the product name and navigation, the top bar and `<main>`. Below 768px the sidebar becomes a horizontal bar. Render exactly one AppShell, in `App.tsx`.
