---
name: author-policy
description: Write or change a design-warden.policy.json - rule categories, enforcement, scopes, component registry, reference patterns, guidance links, exceptions and executable examples. Use when turning design guidance (for example a design skill) into enforceable rules, or when a policy must be adjusted.
---

# Authoring a Design Warden policy

The full guide is `docs/policy-authoring.md`; the schema is `packages/core/schema/policy.schema.json`. This skill is the working checklist.

## Turning guidance into rules

Do not turn every sentence of the design guidance into a rule. For each candidate, decide:

| If the guidance is… | Category | Verify by | Default enforcement |
|---|---|---|---|
| Objective and checkable everywhere (tokens, no literal colors) | `mandatory` | a check | block |
| Required where a pattern applies (component contracts, required states) | `required-pattern` | a check | block |
| An established way that may be overridden for a reason | `preferred` | a check or `semantic` | review |
| A principle that needs judgment | `advisory` | `semantic` or `manual` | report |

- `semantic` rules can never use `enforcement: "block"`; the schema rejects it.
- Use `enforcement` for staged rollout: start a new mandatory rule at `report`, then move to `block` once the codebase is clean.
- Every rule needs `rationale` and `remediation`, written for the developer who sees the finding, plus `guidance` keys that point at the specific section of the design skill.

## Mechanics

- Paths are relative to the policy file. Referenced files must exist; the policy fails validation otherwise.
- `scope.exclude: ["src/design-system/**"]` for consumer rules such as raw controls. The design system itself uses raw elements.
- Components: `replaces` lists raw elements that must use the component; `aliases` lists name fragments that signal a re-implementation; `props` holds contracts (`required`, `allowed`).
- **Exceptions:** prefer policy `exceptions` (rule-specific, path-scoped, with a `reason` and an `expires` date) over inline comments. Inline `design-warden-ignore-next-line <rule> -- <reason>` works only for rules whose category allows it, or with `inlineExceptions: true`.
- Add `examples` to every check-based rule: at least one that passes and one that fails.

## Verify

```bash
pnpm design-warden policy validate --policy <file>
pnpm design-warden policy test --policy <file>
pnpm design-warden check --policy <file>        # full scan; triage what it reports
```

A policy change is itself reported in CI (`policy/changed`), with weakened rules called out. Get owner review, and load the policy from the base branch in CI (`--policy-ref`).
