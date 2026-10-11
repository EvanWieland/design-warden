# Starter policy

The smallest working Design Warden setup: a token file, one design-system component, one app component, a guidance file, and three rules. The rules show the categories and a report-only rollout.

```bash
pnpm design-warden policy validate --policy examples/policy/design-warden.policy.json
pnpm design-warden policy test     --policy examples/policy/design-warden.policy.json
pnpm design-warden check           --policy examples/policy/design-warden.policy.json   # PASS
```

To adapt it to your repository:

1. Copy `design-warden.policy.json` and `GUIDANCE.md` next to your frontend. After `npm install --save-dev design-warden`, both are also in `node_modules/design-warden/starter/`.
2. Point `tokens.sources` at the CSS your token pipeline emits, and set `allowedPrefixes` to your semantic token families.
3. Point `designSystem.paths` and `importSources` at your component library, and register the components that replace raw elements.
4. Point `guidance` at your design skill's sections.
5. Start new rules with `"enforcement": "report"`, fix what they find, then switch to `block`.
6. Run it: `npx design-warden check --base origin/main` from the directory with the policy file (or `pnpm design-warden check --policy ../your-app/design-warden.policy.json --base origin/main` from this checkout).

The full guide is [docs/policy-authoring.md](../../docs/policy-authoring.md). The demo's complete policy is [apps/demo/design-warden.policy.json](../../apps/demo/design-warden.policy.json).
