# @design-warden/core

Part of [Design Warden](https://www.npmjs.com/package/design-warden), which checks frontend pull requests against a design-system policy. Install `design-warden` for the command line; you rarely need this package directly.

This package holds what every engine shares:

- the policy schema and loader (`schema/policy.schema.json` is the JSON Schema that policy files reference);
- the findings model and `decideOutcome`, the only place a finding becomes fail, review or info;
- git and directory change sets, path containment (`resolveInside`) and secret redaction.

MIT licensed.
