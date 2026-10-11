# Changing the design system

The design system is owned by **@acme/design-system**. A one-line token change can restyle every screen, so shared changes are reviewed by the people who own them.

## What needs owner review

- Any change to `src/design-system/tokens.css`.
- Any change under `src/design-system/`: components, their CSS, `base.css` and `index.ts`.
- Any change to `design-warden.policy.json`, which also needs a policy owner.

Design Warden reports these changes with every usage they affect. The pull request MUST be approved by @acme/design-system before merge, and the author SHOULD check the affected screens in the visual diff.

## Tokens

- Add a semantic token for a new purpose instead of reusing one that has the right value but a different meaning.
- Propose new tokens in an issue: the purpose, the value and where it will be used.
- When changing a token's value, attach before and after screenshots of the affected screens.
- Deprecate before removing: mark the token as deprecated in `tokens.css` with a comment naming its replacement, migrate every usage, and remove it only in a later release. Removing a token that is still referenced breaks styling silently.
- `--palette-*` primitives stay internal to `tokens.css`.

## Components

- Prefer extending an existing component, with a new variant or optional prop, over adding a new one.
- A change to a prop contract updates the registry in `design-warden.policy.json` and components.md in the same pull request.
- Removing a prop or variant follows the same path as tokens: deprecate, migrate, then remove.

## Exceptions

- A deviation that cannot be fixed now gets a policy exception with an id, the rules and paths it covers, a reason, the approver and an expiry date. Example: `legacy-partner-promo` lets `src/legacy/` use a partner's brand colors until 2027-03-31.
- Mandatory and required-pattern rules cannot be suppressed inline. Preferred and advisory rules can be, with a comment that names the rule and gives a reason.
