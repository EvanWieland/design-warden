# Interaction states

Every view that shows data MUST handle loading, empty and error. You can preview them on `/orders` with `?state=loading`, `?state=empty` and `?state=error`.

## Loading

- Pass `status="loading"` to DataTable. It renders a Spinner inside a `role="status"` region.
- A Spinner MUST have a `label`, such as "Loading orders".
- Keep the page header and filters visible; only the data area changes.
- Buttons that start slow work use `loading`, which also prevents double submits.

## Empty

- `status="ready"` with no rows renders `emptyState`, which is required.
- Tell first use ("No orders yet") apart from no matches ("No orders match these filters").
- When filters cause the empty state, offer "Clear filters" as the action.

## Error

- Pass `status="error"` to DataTable. It renders a danger Alert (`role="alert"`) with `errorMessage` and, when `onRetry` is set, a "Try again" button.
- Keep what the user entered (filters, form values) after an error.
- Forms validate on submit. Each invalid field gets an `error` (which sets `aria-invalid="true"`), and a danger Alert at the top of the form summarizes them: "Fix 3 fields to continue".

## Disabled

- Use the `disabled` prop on Button, TextField, Select and Checkbox. They use the `--color-action-disabled-*` tokens.
- Always say why something is disabled, in a `hint` ("Requires the Enterprise plan") or next to it ("No unsaved changes").
- Prefer an enabled action that explains the problem when used; disable only when the action is impossible, such as saving with no changes.

## Focus

- Interactive elements show the shared focus ring from `base.css` on `:focus-visible`: an outline in `--color-focus-ring` with the `--shadow-focus` halo.
- MUST NOT remove the outline (`outline: none`) without an equivalent token-based ring.
- DOM order matches visual order; don't use a positive `tabindex`.
- Wide tables scroll inside a focusable region so keyboard users can reach every column.
