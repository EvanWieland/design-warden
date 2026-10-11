# ADR 0004: A versioned JSON policy, data only, validated with zod

Status: Accepted, 2026-10-10

## Context

The policy is the contract between design-system owners, developers, coding agents and CI. It must be reviewable in a pull request, and impossible to turn into a code-execution vector, because it lives in the repository and may be edited by the change under review. No standard exists for enforceable design rules ([design-contracts.md](../research/design-contracts.md)). The closest precedents are API-guideline linters: Google AIP with api-linter, Zalando with Zally, and Spectral.

## Decision

- `design-warden.policy.json`, `policyVersion: 1`, validated by a strict zod schema. Unknown keys are errors. A JSON Schema generated from it (`design-warden policy schema`) gives editor completion.
- **Data only.** A rule selects a built-in check by id (`verify: { by: "check", check: "no-hardcoded-color", options }`) or names `semantic` or `manual` verification. There are no script, command, module-path or URL fields. Visual actions are a closed vocabulary (click, hover, focus, fill, press). Every path is resolved inside the policy's directory.
- Each rule has an id and a version, category, severity, enforcement, description, rationale, scope, guidance references, remediation, and executable examples:
  - **Category** says what kind of rule it is: `mandatory` (MUST, objectively checkable), `required-pattern` (MUST where the pattern applies), `preferred` (SHOULD) or `advisory` (MAY / context).
  - **Severity** says how bad a violation is.
  - **Enforcement** says what CI does with a confirmed violation: `block`, `review` or `report`.
  - Severity and enforcement default from the category and can be overridden, which allows staged rollout (report first, block later).
- Component registry, reference patterns and guidance index live in the same file, so rules reference them by key and the schema checks that the keys exist.
- Exceptions:
  - **Policy exceptions:** rule-specific, path-scoped, with a mandatory reason and an optional expiry. An expired exception stops applying and raises a review finding.
  - **Inline exceptions** (`design-warden-ignore-next-line <rule> -- <reason>`): only for rules that allow them. The default is no for mandatory and required-pattern rules, because coding agents habitually add disable comments. Blanket or unexplained directives are rejected and reported.

## Consequences

- Policy changes are ordinary, reviewable diffs. CI also reports them (ADR 0006).
- No conditional logic in the policy. Anything conditional becomes a new built-in check with options, which is a code review, not a config change.

## Alternatives considered

- **YAML:** friendlier, but needs a parser and has implicit-typing pitfalls.
- **TypeScript config files:** executable, so rejected.
- **Policy derived from SKILL.md prose:** not checkable.
