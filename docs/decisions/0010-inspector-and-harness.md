# ADR 0010: The inspector is a static UI plus a localhost-only service; scenarios run in temporary git repos

Status: Accepted, 2026-10-10

## Context

The demo must run real analyses from a web UI without turning a local tool into a remote-execution surface. The seeded scenarios must be reproducible and resettable.

## Decision

- **Scenario harness (`tools/harness`).** Each scenario is `fixtures/scenarios/<id>/scenario.json` (title, description, expected outcome and findings) plus an `overlay/` of files relative to `apps/demo`.
  - `run` copies the clean demo into `.design-warden/runs/<id>/`, commits it as the base of a temporary git repository, applies the overlay, and calls `analyze()` with `--base`. This is the same code path as CI.
  - Visual mode builds base and head with Vite and captures both in the same process.
  - `apply` and `reset` copy an overlay into `apps/demo` with a backup manifest, so the running demo shows the change, and restore it afterwards.
- **Inspector service (`apps/inspector/server`).**
  - Node `http`, bound to 127.0.0.1. Requests whose `Host` is not localhost are rejected (DNS-rebinding defence). POST requires `Content-Type: application/json`, which a cross-site page cannot send without a CORS preflight, and, when an `Origin` header is present, it must be this server (CSRF defence). No CORS headers.
  - Fixed endpoints: list scenarios; start a run of a *known* scenario id with two booleans; poll run status; read run artifacts through `resolveInside` with an extension allowlist; read guidance files named by the policy.
  - Runs are serialised, and progress comes from the orchestrator's real progress events.
  - No endpoint accepts a path, command or code.
- **Inspector UI.** A Vite/React SPA with its own small token system. It reads reports from the service or from a JSON file the user opens (`check --report`), so it also works for CLI output from any project. Model text is rendered as plain text.

## Consequences

- One command starts the whole demo. Nothing listens beyond loopback.
- The service trusts the local user, which is fine for a developer tool. It is not designed to be exposed on a network, and SECURITY.md says so.
