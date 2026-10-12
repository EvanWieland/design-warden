# Policy authoring

A policy (`design-warden.policy.json`) is the enforceable subset of your design guidance. The guidance itself, for example a Claude Agent Skill, stays prose for humans and agents. The policy says which parts are checked, how strictly, and where the guidance for each rule lives.

- **Schema:** `packages/core/schema/policy.schema.json`. Set `"$schema"` in your file for editor completion. Regenerate with `pnpm schema` after changing `packages/core/src/policy/schema.ts`.
- **Full example:** [`apps/demo/design-warden.policy.json`](../apps/demo/design-warden.policy.json).
- **Starter:** [`examples/policy/design-warden.policy.json`](../examples/policy/design-warden.policy.json).

The policy is data. It cannot name scripts, commands, modules or URLs to execute. All paths resolve inside the policy file's directory. Unknown keys are errors, so a typo never silently disables something.

## Structure

| Key | Purpose |
|---|---|
| `policyVersion` | Always `1` (the file format version) |
| `name`, `revision`, `owners` | Identity; `revision` is yours to bump (for example `2026.10.1`) |
| `project.include` / `exclude` | Files Design Warden analyses (globs, relative to the policy): `.ts`/`.tsx`, `.js`/`.jsx` (JSX allowed), `.css`/`.scss`, `.vue`, `.svelte` |
| `designSystem.paths` | Files that implement the design system; changes there are shared changes |
| `designSystem.importSources` | Import specifiers that count as the design system: package names (`@acme/ds`) or project paths (`src/design-system`) |
| `tokens.sources` | Files that define the tokens: CSS custom properties (your build output) or DTCG `*.tokens.json` (see [Token sources](#token-sources)) |
| `tokens.allowedPrefixes` | Token families application code may use (`--color-`, `--space-`, …); everything else defined there is internal |
| `components[]` | Registry: `name`, `source`, `replaces` (raw elements and ARIA roles), `aliases` (re-implementation hints), `props` (contracts), `guidance` |
| `patterns[]` | Reference implementations used for provenance |
| `guidance{}` | Index of guidance sections: `title`, `path` (+ `section` heading) or `url` |
| `rules[]` | The rules (below) |
| `exceptions[]` | Reviewed, time-boxed exceptions |
| `approvals[]` | Accepted review requests, each bound to one finding's fingerprint, with a reason, an approver and a required expiry (see [Exceptions](#exceptions)) |
| `visual` | Viewports, routes, states (query, declarative actions, `waitFor`) and masked selectors |
| `semanticReview` | Whether model review is allowed and its limits (`maxFiles`, `maxFileChars`, `includeScreenshots`, guidance to include) |
| `failurePolicy` | What a failed engine means: `fail-closed`, `review` or `fail-open` per engine |

## Token sources

`tokens.sources` lists the files that define the design tokens. Each is either:
- **CSS or SCSS** with custom properties (`--color-text-primary: #0f172a;`), usually your build output. A token's default value is its definition under `:root`, `html`, `:host` or Tailwind's `@theme`; without one (tokens scoped to a class, as in many SCSS themes), the first selector's wins. Under one selector the last definition applies, as in CSS. A token defined only in a theme that overrides other tokens (only in `.dark`) has no default value, so no suggestion names it. In SCSS, names a loop generates (`--radius-#{$name}`) count as defined tokens, with values only Sass knows. Overrides in other selectors and in media queries (`.dark { … }`, `@media (prefers-color-scheme: dark) { :root { … } }`) are themes: `shared-change` compares them too, and `token-usage` suggests a replacement only if it has the same value in every theme.
- **A DTCG file** (`*.tokens.json`, [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/2025.10/format/)), the source format many token pipelines start from.

DTCG tokens are read as the CSS custom properties your build would generate:
- **Names:** the token's path, each segment kebab-cased and joined with `-`, as Style Dictionary's `css/variables` format does: `color.text.primary` → `--color-text-primary`, `fontSize.2xl` → `--font-size-2xl`, `Hot pink` → `--hot-pink`. A group's `$root` token takes the group's name (`color.accent.$root` → `--color-accent`). If two paths produce the same name, the last wins, as in the CSS your build would generate. If your build names variables differently, point `tokens.sources` at the generated CSS instead.
- **Values:** `{group.token}` and `{ "$ref": "#/group/token/$value" }` references become `var(--group-token)`, so aliases resolve as in CSS. Colors use their `hex` fallback, or computed hex for sRGB, else a CSS color function (`oklch(…)`, `color(display-p3 …)`). Dimensions and durations become `16px`, `1rem`, `150ms`; `cubicBezier` becomes `cubic-bezier(…)`; font families are joined. Composite values (shadow, typography, …) are kept as data: changes to them are reported, but they never match a literal.
- **`$type` and `$deprecated`** are inherited from groups, and `$extends` merges the extended group in.
- **Deprecated tokens** (`"$deprecated": true` or a reason) are reported by `token-usage` wherever application code references them, and are never suggested as a fix.

## Rules

```jsonc
{
  "id": "color/semantic-tokens",          // lowercase, '/', '-', '.'
  "version": 1,                            // bump when the meaning changes
  "title": "Colors come from semantic tokens",
  "category": "mandatory",
  "severity": "error",                     // optional; defaults from category
  "enforcement": "block",                  // optional; defaults from category
  "description": "Every color … is a semantic color token.",
  "rationale": "Literal colors drift from the palette …",
  "verify": { "by": "check", "check": "no-hardcoded-color", "options": { "tokenPrefix": "--color-" } },
  "scope": { "exclude": ["src/design-system/**"] },
  "guidance": ["color", "tokens"],
  "remediation": "Replace the literal with the semantic token for its purpose …",
  "examples": [
    { "file": "src/pages/Example.css", "code": ".a { color: #475569; }", "expect": "fail" },
    { "file": "src/pages/Example.css", "code": ".a { color: var(--color-text-secondary); }", "expect": "pass" }
  ],
  "inlineExceptions": false                // optional; see Exceptions
}
```

### Categories, severity, confidence and enforcement

These are four separate questions:

| Field | Question | Set by |
|---|---|---|
| **Category** | What kind of requirement is this? | The rule |
| **Severity** | How bad is a violation? | The rule (default from the category) |
| **Enforcement** | What does CI do with a confirmed violation? | The rule (default from the category) |
| **Confidence** | How sure is the engine about this finding? | The engine, per finding. Never used for blocking |

| Category | Meaning | Example | Default severity / enforcement / inline exceptions |
|---|---|---|---|
| `mandatory` | MUST, objectively checkable everywhere | No literal colors; only semantic tokens; spacing scale | error / **block** / no |
| `required-pattern` | MUST where the pattern applies | Use `<Button>` not `<button>`; `DataTable` needs `status` and `emptyState` | error / **block** / no |
| `preferred` | SHOULD; deviations need a reason | Reuse `Badge` instead of a custom pill; review novel patterns | warning / **review** / yes |
| `advisory` | MAY / context; needs judgment | "States explain what happened and what to do next" | info / **report** / yes |

CI then combines the finding's verdict with the rule's enforcement ([architecture.md](architecture.md#outcome-rules)): a confirmed violation of a `block` rule fails; probable violations and insufficient evidence at most request review; model findings at most request review.

- **Staged rollout:** introduce a rule as `"enforcement": "report"`, fix the existing findings (they show as info), then switch to `block`.
- **Change scoping:** with `--base`, findings outside the changed lines are *pre-existing* and never block. Legacy code does not stop unrelated work.

### Verification methods

| `verify.by` | Means | Can block? |
|---|---|---|
| `check` | A built-in deterministic check with `options` validated at load time. List them with `design-warden checks`; reference in [rules.md](rules.md) | Yes |
| `semantic` | Judged by the optional model reviewer, if enabled | **No**: the schema rejects `enforcement: "block"` |
| `manual` | Documented only; passed to reviewers as context | No |

### Examples are tests

`design-warden policy test` runs every rule's `examples` through the rule's real check, options and scope. It fails if an example does not behave as declared, for instance if the example file falls outside the rule's scope. Add at least one passing and one failing example per check-based rule.

## Component registry

```json
{
  "name": "DataTable",
  "source": "src/design-system/components/DataTable.tsx",
  "replaces": ["table"],
  "aliases": ["table"],
  "props": {
    "status": { "required": true, "allowed": ["loading", "error", "ready"] },
    "emptyState": { "required": true }
  },
  "guidance": ["components", "states"]
}
```

- `replaces`: selectors for what the `raw-element` check reports outside the rule's scope exclusions: `tag`, `tag[attr=value]` or `[attr=value]`, for example `"button"`, `"input[type=checkbox]"`, `"[role=button]"`.
- `aliases`: words (`pill`, `chip`, `banner`) that, as the last word of a new component's name (`StatusPill`), make `duplicate-component` ask whether it re-implements this one. They are a heuristic, so the findings are probable violations (review). Choose aliases that rarely appear in unrelated names; see the known false positives in [evaluation.md](evaluation.md).
- `props`: contracts checked at every call site. Literal values are judged. A runtime value is not. A missing required prop is a violation, unless spread props could supply it; then it is insufficient evidence.

## Reference patterns and provenance

```json
{ "id": "filterable-list", "name": "Filterable list", "reference": "src/pages/OrdersPage.tsx", "description": "…", "guidance": ["patterns"] }
```

The `pattern-provenance` check compares each changed component with these references and with existing components. It classifies each as established, modified, novel or insufficient evidence ([rules.md](rules.md#pattern-provenance-heuristic-needs---base)). Its options decide which classes become findings, and how: `review`, `notice` or `off`. A novel pattern is never a violation.

## Exceptions

| Mechanism | Use for | Rules |
|---|---|---|
| **Policy exception** | Known, approved deviations (legacy code, partner branding) | Names specific rules (no wildcards), path globs, a `reason` of 10 or more characters, optional `approvedBy` and `expires` (YYYY-MM-DD). After expiry it stops applying and a `policy/exception-expired` finding requests review. |
| **Approval** (`approvals[]`, [ADR 0012](decisions/0012-approvals.md)) | One accepted review request: a novel pattern, an intended visual change, a value the engine cannot resolve | Clears only a finding whose outcome would be `review`, never a blocking one. Names the finding's `fingerprint` (its `id` in the JSON report), `rule`, `file` (omitted for findings without a location), a `reason` of 10 or more characters, `approvedBy` and a required `expires`. Any edit to the flagged code (whitespace aside; anywhere in the span for a multi-line finding such as a component) changes the fingerprint, and the request returns. In CI, approvals are read from the base branch with the rest of the policy, so a change cannot approve its own requests; the approvals it adds are listed in `policy/changed`. |
| **Inline exception** `/* design-warden-ignore-next-line <rule-id> -- <reason> */` | One-off, local cases | Applies to one rule on the next line. Must name the rule and give a reason. Not allowed for `mandatory` and `required-pattern` rules unless the rule sets `"inlineExceptions": true`. Rejected directives are reported (`policy/inline-exception-rejected`) and the finding stays active. |

Suppressed findings stay in the JSON report (`suppressed: { by, reason }`, plus `approvedBy` for approvals) for audit.

An approval entry. Copy `fingerprint` from the finding's `id` in the JSON report (SARIF has it as `partialFingerprints["designWarden/v1"]`); the value below is made up:

```json
"approvals": [
  {
    "fingerprint": "3f9c1a7e5b2d8046",
    "rule": "patterns/provenance",
    "file": "src/pages/ActivityPage.tsx",
    "reason": "New timeline pattern accepted in the 2026-10 design review",
    "approvedBy": "design-system team",
    "expires": "2027-04-01"
  }
]
```

Not repeating a request on every push of the same pull request is left to the platform: dismiss the code-scanning alert (SARIF carries the fingerprint, so the dismissal persists), or gate `--fail-on review` on a label.

## Governance

- Changing the policy file is always reported (`policy/changed`, review), with rule-level changes listed. Removed or weakened blocking rules are called out.
- In CI, load the policy from the base branch: `--policy-ref origin/main`. A pull request then cannot weaken the rules that judge it.
- Protect the policy, the design-system paths and the workflow with CODEOWNERS.

## Adding a new kind of check

Follow the `add-design-rule` skill (`.claude/skills/add-design-rule/SKILL.md`): contract, `defineCheck` module, tests, benchmark labels, policy example, docs.
