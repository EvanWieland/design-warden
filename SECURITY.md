# Security policy

Design Warden is an experimental open-source tool. Its security properties, threat model and known limitations are documented in [docs/security.md](docs/security.md). In short:

- The policy file is data; nothing in it is executed.
- Without `--semantic`, nothing leaves the machine. With it, only changed files (capped, secrets redacted on a best-effort basis) go to the provider you configure.
- Model findings can request human review but never fail or pass a change.
- The inspector service listens on 127.0.0.1 only.

## Supported versions

Only the latest commit on `main` is supported while the project is pre-1.0.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use your code host's private vulnerability reporting (on GitHub: Security → Report a vulnerability) and include:

- what an attacker controls (repository content, policy file, pull request, network position);
- the impact (code execution, data exposure, gate bypass, denial of service);
- steps or a minimal repository to reproduce.

We aim to acknowledge reports within five working days. Fixes ship as regular commits with a CHANGELOG entry that credits reporters who wish to be named.

## Hardening checklist for adopters

- In CI, load the policy from the base branch (`--policy-ref`) and protect `.github/workflows/**`, the policy and the design-system paths with CODEOWNERS and a branch ruleset (a starting point is in [docs/ci-integration.md](docs/ci-integration.md#trust-model-in-ci)). This repository has a CODEOWNERS file, but its plan (private, free) cannot enforce rulesets.
- Keep `permissions: contents: read`. Run any job with a model key separately from pull-request code (see `examples/github-actions/design-warden.yml`).
- Review `--semantic-dry-run` output before enabling a hosted model on private code, or use a local model.
- Pin GitHub Actions to commit SHAs.
