# ADR 0002: TypeScript pnpm workspace, run from source on Node 24

Status: Accepted, 2026-10-10

## Context

We need shared types across a CLI, three engines, a local service and two web apps, with as little build orchestration as possible. Node 24 strips TypeScript types natively. A test (2026-10-10, Node 24.21) ran a workspace package's `.ts` entry point through a pnpm symlink with no warning. TypeScript 7.0 (the Go port) is the current compiler and type-checks this repository in about a second.

## Decision

- pnpm 12 workspace with packages `core`, `source-analysis`, `visual-analysis`, `semantic-review` and `cli`, plus apps `demo` and `inspector`, and `tools/harness`.
- Packages export `./src/index.ts` directly. Code uses only erasable syntax (`erasableSyntaxOnly`), with explicit `.ts` import extensions and `import type`.
- `tsc -p tsconfig.json` (TS 7) type-checks and never emits. The web apps are built by Vite.
- Pinned dependencies (`--save-exact`). pnpm's supply-chain settings are stated in `pnpm-workspace.yaml`:
  - `minimumReleaseAge` (one day)
  - `strictDepBuilds` (install scripts need approval)
  - `blockExoticSubdeps`
  - `trustPolicy: no-downgrade`
- Engines in separate packages for one real reason: dependency and network isolation. Only `visual-analysis` loads Playwright, and only `semantic-review` contains code that calls a network service, so the "no network unless configured" property can be audited per package.

## Consequences

- `node packages/cli/src/bin.ts` works straight from a checkout. Tests import sources directly, so there is no stale `dist/`.
- Publishing to npm needs JavaScript, because Node refuses to strip types under `node_modules`. Added later (backlog B11) without changing how the repository runs:
  - each package has a `tsconfig.build.json` (composite, `rewriteRelativeImportExtensions`, declarations), and `pnpm build` runs `tsc -b` over the project references into each `dist/`;
  - `publishConfig` swaps `exports` and `bin` to `dist/` when pnpm packs, and `files` ships only `dist/` (plus core's `schema/`);
  - `pnpm test:pack` builds, packs, installs the tarballs into a fresh project with npm, and runs `design-warden` from `node_modules`.
  The repository, its tests and the CLI still run from `src/`, so a stale `dist/` cannot affect them.
- The repository requires Node >= 24.11. The published packages run from `dist/` on Node 22.18+ or 24.11+, Babel 8's range, and CI tests them on Node 22 (amended 2026-10-11).

## Alternatives considered

- **`tsc -b` with project references and `dist/` builds for everyday use:** more moving parts, and stale-build bugs. Used only for packing.
- **A single package:** simpler, but it would mix Playwright and network code into every install.
- **npm workspaces:** no `minimumReleaseAge` or build-script approval.
