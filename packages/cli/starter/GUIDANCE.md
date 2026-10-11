# Design guidance (starter)

Your design system's real guidance lives wherever your team keeps it, for example a Claude Agent Skill. The policy points at sections by heading.

## Color

Use `--color-*` tokens for every color. Pick the token by purpose (text, background, action), not by value.

## Spacing

Use the `--space-*` scale for margins, paddings and gaps.

## Components

Render buttons with `<Button>` from `src/ui`. It provides focus, disabled and loading states.
