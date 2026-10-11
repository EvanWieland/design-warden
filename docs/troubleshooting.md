# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm: command not found` | pnpm is not on PATH | `corepack enable`, or prefix commands with `corepack pnpm` |
| `ERR_UNKNOWN_FILE_EXTENSION ".ts"` or syntax errors when running the CLI | From this repository: Node older than 24.11 (development needs it). From npm: Node older than 22.18, or 23.x / 24.0–24.10, outside Babel 8's range | Use Node 24.11+ for the repository, 22.18+ or 24.11+ for the npm packages (`node --version`) |
| `pnpm install` fails about a version "published less than … ago" | `minimumReleaseAge` (1 day) blocks just-published versions | Wait, or pin the previous version; do not lower the setting casually |
| `pnpm install` fails with unreviewed build scripts | `strictDepBuilds` | Approve the package in `allowBuilds` in `pnpm-workspace.yaml` after reviewing its script |
| `design-warden: policy failed validation:` | Schema problem, missing referenced file, unknown check, invalid option | Each problem is listed with its path; fix and re-run `design-warden policy validate` |
| `unknown git ref "origin/main"… fetch-depth` | Shallow clone or the ref was not fetched | `git fetch origin main`; in Actions use `fetch-depth: 0` |
| Everything is "pre-existing" | The finding lies outside the changed lines (`--scope changed-lines` is the default with `--base`) | Expected for legacy code; use `--scope changed-files` or `all` to see more, and `--verbose` to list them |
| `could not start Chromium … playwright install chromium` | Browsers not installed | `pnpm exec playwright install chromium` (Linux CI: `--with-deps`) |
| On Windows, `pnpm build` or `pnpm --filter … build` fails with "os error 3" (the system cannot find the path) | The checkout path is long enough to push a file pnpm writes for the task past Windows' 260-character limit | Clone to a shorter path (for example `C:\src\design-warden`), or enable Win32 long paths (`LongPathsEnabled`, needs administrator rights) and open a new terminal |
| `refusing to compare captures from different environments` | Base and head captured with different Playwright, browser, headless mode, OS or scale | Capture both in the same job and container |
| `Could not compare <route>/<state>: … waiting for "<selector>" failed` | The `waitFor` selector never appeared (route broken, or state not reachable) | Open the URL from the message; fix the route or the state's `waitFor` |
| Visual diffs on screens you did not touch | A shared token or component changed, or capture is unstable (fonts, animations, time, network) | Check the token-change finding; add `mask` selectors for volatile content; capture base and head in one job |
| Semantic review `failed: auth` | No credentials | Set `ANTHROPIC_API_KEY` (or `ant auth login`); for openai-compatible set `DESIGN_WARDEN_OPENAI_*` |
| Semantic review `failed: rate-limited` / `timeout` | Provider limits | Retry later; raise `--semantic-timeout`; outcome becomes review by default (deterministic findings unaffected) |
| Semantic review `failed: malformed response` / `cut off` | The model ignored the schema or ran out of tokens | Use a model with structured-output support; for OpenAI reasoning models set `DESIGN_WARDEN_OPENAI_TOKEN_PARAM=max_completion_tokens` |
| Many AI findings "rejected" | Citations did not match the files shown | Working as intended: fabricated references never reach the report as findings; see `report.semantic.rejected` |
| Inspector shows "UI is not built yet" | `apps/inspector/dist` missing | `pnpm inspector` builds it first, or run `pnpm --filter @design-warden/inspector build` |
| Inspector returns 421 | Opened through a hostname other than `127.0.0.1` or `localhost` | Use http://127.0.0.1:4400 (DNS-rebinding protection) |
| `scenario "…" is already applied` | A previous `pnpm scenario apply` was not reset | `pnpm scenario reset` |
| Disk use under `.design-warden/` | Each scenario run keeps its workspace and captures | `pnpm scenario clean` |
| CRLF warnings from git in tests | Global `core.autocrlf=true` | Harmless; the harness pins `core.autocrlf=false` for its repositories |
| `Filename too long` or `ENAMETOOLONG` on Windows, usually during `pnpm scenario run` | Scenario workspaces live under `.design-warden/runs/<id>/<run>/workspace`, and with `node_modules` links paths can pass 260 characters | The harness already runs git with `core.longpaths=true`. Also enable Windows long paths (the `LongPathsEnabled` policy), or clone to a short path such as `C:\dw` |
| `--base HEAD` fails with an unknown ref | The checkout has no commits (for example, a downloaded archive) | Commit once, compare with an older copy of the project using `--base-dir <dir>`, or run without `--base` (full scan) |
