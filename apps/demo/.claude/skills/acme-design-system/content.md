# Writing for interface states

Write plainly and specifically. Use sentence case, name things the way users do ("orders", not "records" or "data"), and avoid blame, jargon and exclamation marks.

Every state message answers two questions: what happened, and what can I do now?

## Loading

- Spinner labels: "Loading" plus the thing, such as "Loading orders".
- Don't write "Please wait" or "Hang tight".

## Empty

- Title states the fact: "No orders yet", "No orders match these filters".
- Description says why and how to change it: "Try another search term or status, or clear the filters to see every order."
- Action: the one step that fixes it, such as "Clear filters" or "New order".

## Error

- Title names what failed: "Orders could not be loaded".
- Message gives the likely cause and the next step, and says what is safe: "The order service did not respond. Your filters are kept, so you can try again right away."
- Never show error codes, stack traces or "Something went wrong" on its own.

## Form validation

- Say what to enter, not what went wrong: "Enter a customer name", "Choose a product", "Enter a quantity of at least 1".
- Summary: "Fix 1 field to continue", "Fix 3 fields to continue".

## Success, disabled and hints

- Confirm in the past tense, then what happens next: "Order created. The warehouse team can see it in their queue now."
- Explain disabled controls by their requirement: "Requires the Enterprise plan", "Contact support to change this", "No unsaved changes".

## Buttons and links

- Buttons start with a verb: "Create order", "Try again", "Clear filters". Not "OK" or "Submit".
- Links name the destination: "View all orders". Not "Click here".

| Instead of | Write |
| --- | --- |
| Error 503 | Orders could not be loaded |
| No data | No orders match these filters |
| Invalid input | Enter a quantity of at least 1 |
| Submit | Create order |
