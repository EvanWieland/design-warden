# Page patterns

Each page is a `<Stack gap={6}>` inside the AppShell and starts with a `PageHeader`. Start from the reference file of the closest pattern.

## Filterable list

Reference: `src/pages/OrdersPage.tsx`.

1. `PageHeader` with a title, a one-sentence description and one primary action, such as "New order".
2. A `Card` holding a `<Stack gap={5}>` with:
   - a `FilterBar` of labelled TextField and Select filters, with `onReset`;
   - a `DataTable` whose `status` comes from the data hook, with an `emptyState` for "no matches" (action: "Clear filters"), an `errorMessage` and `onRetry`.

Filters keep their values through loading and error states.

## Form page

Reference: `src/pages/NewOrderPage.tsx`.

1. `PageHeader` with a title and a description of what happens on submit.
2. A `Card` holding one `<form noValidate>`, at most 40rem wide, with a `<Stack gap={5}>` of fields.
3. Every field has a visible label; required fields set `required`.
4. Validate on submit: give each invalid field an `error` and show a danger Alert summary ("Fix 2 fields to continue") at the top of the form. Confirm success with a success Alert.
5. Actions come last, left-aligned in a `<Stack direction="row" gap={3}>`: one primary submit Button, then a secondary or ghost Cancel.

## Dashboard summary

Reference: `src/pages/OverviewPage.tsx`.

1. `PageHeader` whose description names the period ("week of 6 October 2026").
2. Up to four StatCards in a `<Stack direction="row" gap={4} wrap>`.
3. Cards that summarize recent activity, each with at most five rows and a Link to the full list in `actions` ("View all orders").

## Introducing a new pattern

New patterns are welcome when a screen needs something the patterns above don't cover. Design Warden flags novel compositions for design review; that is a prompt to explain, not a failure.

A new pattern MUST:

- compose existing design-system components and tokens, with no new colors, spacing values or look-alike components;
- handle loading, empty and error states if it shows data;
- keep one primary action per view.

In the pull request, describe the user need, say why the existing patterns don't fit, link the guidance the pattern follows and add screenshots of each state. If other screens will need it, propose it to @acme/design-system for this file.
