# Visual regression testing and screenshot review

Last verified: 2026-10-10. Covers playwright-core 1.64.0, pixelmatch 8.0.0, pngjs 7.0.0 and odiff-bin 4.5.0. **[Verified: experiment]** means I reproduced the result locally (Windows 11, Node 24.21, using the installed Chrome 155 and Edge 155; no Playwright browser download).

## Questions

1. Which Playwright library APIs make screenshots deterministic? Can we reuse the comparator?
2. What are the pixelmatch 8 and pngjs 7 APIs? Is odiff better?
3. How do the major tools handle baselines, review, change selection and hosting?
4. How do tools localise changed regions?
5. Nondeterminism: same-run base/head capture or committed baselines?
6. What can a diff prove?

## Findings

### 1. Playwright as a library

- [Verified](https://unpkg.com/playwright-core@1.64.0/types/types.d.ts) **`page.screenshot` options:** `animations:'disabled'` fast-forwards finite animations and resets infinite ones (default `'allow'`). `caret` defaults to `'hide'`. `mask` covers each locator with a `maskColor` box (default `#FF00FF`), invisible matches included. `style` CSS reaches into shadow DOM and iframes. `scale` defaults to `'device'`.
- [Verified](https://playwright.dev/docs/api/class-browser#browser-new-context) **Context options:** `deviceScaleFactor` (default 1), `colorScheme`, `reducedMotion`, `forcedColors`, `locale`, `timezoneId`. `route()` misses requests a Service Worker intercepts, so set `serviceWorkers:'block'`.
- [Verified](https://playwright.dev/docs/api/class-clock) **Clock:** `clock.install` fakes `Date`, `Temporal.Now`, timers, rAF and `performance`. `setFixedTime` pins only `Date`.
- [Verified](https://unpkg.com/playwright-core@1.64.0/lib/coreBundle.js) **Fonts and colour:** screenshots wait for `document.fonts.ready`, and Chromium gets `--force-color-profile=srgb`. `--font-render-hinting=none` and `--disable-lcd-text` are not defaults. Argos recommends both, and notes that the hinting flag only takes effect in headless mode ([Verified](https://argos-ci.com/docs/llms-full.txt)).
- [Verified](https://unpkg.com/playwright@1.64.0/lib/matchers/expect.js) **`toHaveScreenshot` only runs inside the test runner.**
  - Its "two consecutive equal screenshots" loop is the private `page._expectScreenshot`.
  - Its comparator is a vendored YIQ pixelmatch (about v5, threshold 0.2) plus an undocumented `_comparator:'ssim-cie94'`. It is reachable only through internals (`playwright-core/lib/coreBundle` → `utils.getComparator`).
- [Verified: experiment] **This recipe gave 5 of 5 byte-identical PNGs:** a route allow-list, `clock.setFixedTime`, a stubbed `Math.random`, animations disabled and the caret hidden. The documented `install()`+`pauseAt()` pattern was not stable: a load-time `Date` jittered by milliseconds (19 px diff). Leaving animations on gave 303 px; a visible caret gave 10 px.

### 2. Diff engines

- [Verified](https://github.com/mapbox/pixelmatch) **pixelmatch 8.0.0** (2026-10-06, ISC, ESM-only since v6):
  - `pixelmatch(img1, img2, out|null, w, h, opts)` returns the number of mismatched pixels and throws if sizes differ.
  - Options: `threshold` (0.1, now an OKLab HyAB distance), `includeAA`, `alpha`, `aaColor`, `diffColor`, `diffColorAlt`, `diffMask`, `checkerboard`. New in v8: `windowSize` (the maximum count in any N×N window) and `ignoreMask`.
  - The new metric means counts differ from v7 and from Playwright ([Verified](https://github.com/mapbox/pixelmatch/releases)).
  - [Verified: experiment] On Node 24, `require()` returns the namespace; use `.default`.
- [Verified: experiment] **pngjs 7.0.0** (MIT, CommonJS; ESM named import works): `PNG.sync.read(buf)` returns `{width,height,data}`, and `PNG.sync.write(png)` round-trips losslessly.
- [Verified](https://unpkg.com/odiff-bin@4.5.0/odiff.d.ts) **odiff-bin 4.5.0** (MIT, Zig/SIMD) ships a native binary per platform via `optionalDependencies`. Its API takes file paths (`ODiffServer` keeps worker processes alive). It uses YIQ and returns `diffCount`, `diffPercentage` and optionally the changed rows and columns, which is one bounding box, not clusters. Argos uses it. On a toy image it matched pixelmatch's count.
- [Verified: experiment] **Default thresholds hide token swaps.** I moved flat fills to an adjacent Tailwind v3 shade (blue-600→700, gray-900→800, red-600→500, white→slate-50) and rgb(30,100,200)→(60,100,200).
  - At the defaults (pixelmatch 8 at 0.1, Playwright at 0.2) all five gave **0** differing pixels.
  - pixelmatch caught 3 of 5 at 0.05 and all five at 0.02. `ssim-cie94` caught all five.

### 3. Tools

| Tool | Licence/hosting | Baseline | Review | Change selection |
|---|---|---|---|---|
| Chromatic | SaaS; CLI MIT | Latest ancestor build; accepted snapshots carry forward [V](https://www.chromatic.com/docs/branching-and-baselines/) | Accept/deny; UI Review diffs against the branch point | TurboSnap: git diff plus Webpack/Vite graph; changes to Storybook config or preview imports force a full run [V](https://www.chromatic.com/docs/turbosnap/) |
| Percy | SaaS; CLI MIT | PR target branch's latest build, or last approved build [V](https://www.browserstack.com/docs/percy/visual-testing-workflows/baseline-management/understand-baseline) | Approve snapshot or build; AI agent | IntelliStory: git plus dependency graph [V](https://www.browserstack.com/docs/percy/references/storybook-advance-topics/intellistory) |
| Applitools | Proprietary; cloud or on-prem [V](https://help.applitools.com/hc/en-us/articles/360007189231) | Per app, test, OS, viewport and browser; branchable [V](https://help.applitools.com/hc/en-us/articles/360006914692) | Accept; match levels (Strict, Layout, Ignore Colors, Exact) | Not checked |
| Argos | MIT, backend included; self-hosting undocumented [V](https://argos-ci.com/docs/llms-full.txt) | Latest approved build whose commit is an ancestor of the merge-base [V](https://argos-ci.com/docs/baseline-build) | Approve/reject; flaky badges | Subset (partial) builds: removed screenshots ignored; never used as baselines |
| Lost Pixel | MIT; **archived 2026-04-22, being shut down** [V](https://github.com/lost-pixel/lost-pixel) | | | |
| BackstopJS | MIT, local | Committed references; `referenceUrl` captures from another URL [V](https://github.com/garris/BackstopJS) | `backstop approve` | None |
| reg-suit | MIT; images in S3/GCS | Base commit found by walking the git graph [V](https://github.com/reg-viz/reg-suit) | Failing status turns green on PR approval [V](https://github.com/reg-viz/reg-suit/tree/master/packages/reg-notify-github-plugin) | None |

- [Verified](https://www.chromatic.com/docs/snapshots/) [Verified](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow) **Chromatic and Percy render in their own standardised cloud browsers.** Percy re-renders a serialised DOM with JavaScript disabled.
- [Verified](https://storybook.js.org/docs/configure/user-interface/change-detection) **Storybook 10.x "change detection"** (git diff plus module graph) is a dev-only preview.

### 4. Region localisation

- **Existing approaches:** Resemble.js returns one `diffBounds` box ([Verified](https://github.com/rsmbl/Resemble.js/blob/master/resemble.js)); odiff gives changed rows and columns; reg-suit's x-img-diff marks inserted or moved regions; Argos uses "pixel clustering" against noise ([Verified](https://argos-ci.com/docs/llms-full.txt)). WebSee maps diff pixels to HTML elements via the layout tree ([Verified](https://computer.org/csdl/proceedings-article/icst/2015/07102586/12OmNyjccCu), abstract only).
- [Verified: experiment] **Grid clustering works on toy images.** Method: 8 px cells, keep cells with at least 4 diff pixels, take 8-connected components. A 2 px shift gave 2 boxes; 291 scattered noise pixels gave none. `windowSize:16` also separated them: noise 5, shift 32.

### 5. Nondeterminism

- [Verified](https://playwright.dev/docs/test-snapshots) **Rendering varies with "host OS, version, settings, hardware, power source… headless mode".** Snapshot names include the platform. Pin the Docker image, e.g. `mcr.microsoft.com/playwright:v1.64.0-noble` ([Verified](https://playwright.dev/docs/docker)). The headless shell and new headless differ ([Verified](https://playwright.dev/docs/browsers)).
- [Verified: experiment] **On one machine** (400×300 page, threshold 0): headless vs headed differed by 784 px; DPR 1 vs 2 at `scale:'css'` by 147 px; Chrome 155 vs Edge 155 by 0 px.
- [Verified](https://arxiv.org/abs/2103.02669) **What makes UI tests flaky:** across 235 flaky UI tests, 44.7% were async-wait problems (rendering 25.9%, animation 11.1%) and 18.7% were environmental.

### 6. What diffs prove

- [Verified](https://arxiv.org/abs/2607.01728) **Pixel diffs are "semantically blind"**, and industry ML tools "lack public evaluation". Percy's agent docs give no methodology for their numbers ([Verified](https://www.browserstack.com/docs/percy/ai-agents/visual-review-agent/overview)).
- [Unresolved] I found **no peer-reviewed false-positive rate.**
- [Inferred] **A diff proves only that pixels changed for one captured state.** It says nothing about intent, token usage or accessibility: hard-coded `#2563eb` renders exactly like `var(--primary)`. It cannot see uncaptured states (hover, focus, errors, other locales or widths). Layout shifts cascade, so diff size is not severity.

## Implications for Design Warden

1. **Drive playwright-core directly**, not `@playwright/test` or its internals. Write our own stability loop: capture until two consecutive buffers are equal, with a retry cap.
2. **Use one fixed preset:** the §1 recipe plus `deviceScaleFactor:1`, `reducedMotion:'reduce'`, `timezoneId:'UTC'`, a fixed `locale`, `serviceWorkers:'block'` and `scale:'css'`.
3. **By default, capture base and head in the same run on the same machine.**
   - Base is the merge-base (or the PR's base SHA) in a worktree, as in Argos and Chromatic UI Review. This removes platform drift, binaries in git and any need for an approval service.
   - Fingerprint each capture (Playwright version, channel, headless mode, OS, DPR) and refuse to compare captures with different fingerprints.
   - Cache base captures by (SHA, fingerprint, config).
   - Defer committed baselines. CI uses the pinned image; local runs need no Docker.
4. **Use pixelmatch 8, pinned exactly, with a threshold around 0.02 (calibrate it).** Suppress noise with `windowSize` and clustering, never by raising the threshold. Skip odiff for v1: native optional dependencies, no clusters.
5. **Report regions, not totals.** Record element rects and component/source attributes at capture time. Map each diff box to the smallest enclosing element and from there to its TSX file. Give the LLM reviewer before/after crops per region, and treat the topmost region of a cascade as primary.
6. **A visual diff means "changed, needs review", never "violation".** CI fails only on deterministic source checks unless the user opts in.
7. **Select captures from the TSX import graph.** Capture everything when tokens, global CSS, the Tailwind config or the lockfile change.

## Open questions

- How byte-stable are real apps (web fonts, lazy images, canvas)? Measure while dogfooding.
- How much does building the base cost in monorepos, and how often does it fail?
- Threshold calibration, including dark themes; headless shell vs new headless.
- Does region-to-component mapping survive production builds?

## Sources

- [Playwright screenshot API](https://playwright.dev/docs/api/class-page#page-screenshot), [1.64 typings](https://unpkg.com/playwright-core@1.64.0/types/types.d.ts): screenshot and context options.
- [Playwright Clock](https://playwright.dev/docs/api/class-clock): faked APIs.
- [playwright-core bundle](https://unpkg.com/playwright-core@1.64.0/lib/coreBundle.js), [expect bundle](https://unpkg.com/playwright@1.64.0/lib/matchers/expect.js): comparator, stability loop, font wait, flags.
- [Snapshots guide](https://playwright.dev/docs/test-snapshots), [Docker](https://playwright.dev/docs/docker), [Browsers](https://playwright.dev/docs/browsers): nondeterminism.
- [pixelmatch](https://github.com/mapbox/pixelmatch), [releases](https://github.com/mapbox/pixelmatch/releases): v8 API and metric.
- [pngjs](https://github.com/pngjs/pngjs): sync API.
- [odiff](https://github.com/dmtrKovalenko/odiff), [odiff-bin typings](https://unpkg.com/odiff-bin@4.5.0/odiff.d.ts): API and output.
- Chromatic: [baselines](https://www.chromatic.com/docs/branching-and-baselines/), [TurboSnap](https://www.chromatic.com/docs/turbosnap/), [threshold](https://www.chromatic.com/docs/threshold/) (default 0.063), [capture](https://www.chromatic.com/docs/snapshots/).
- Percy: [baselines](https://www.browserstack.com/docs/percy/visual-testing-workflows/baseline-management/understand-baseline), [SDK](https://www.browserstack.com/docs/percy/integrate/percy-sdk-workflow), [IntelliStory](https://www.browserstack.com/docs/percy/references/storybook-advance-topics/intellistory), [agent](https://www.browserstack.com/docs/percy/ai-agents/visual-review-agent/overview).
- Applitools: [match levels](https://applitools.com/docs/eyes/concepts/best-practices/match-levels), [baselines](https://help.applitools.com/hc/en-us/articles/360006914692), [deployment](https://help.applitools.com/hc/en-us/articles/360007189231).
- Argos: [baselines](https://argos-ci.com/docs/baseline-build), [docs](https://argos-ci.com/docs/llms-full.txt), [repo](https://github.com/argos-ci/argos): MIT, uses odiff.
- [Lost Pixel](https://github.com/lost-pixel/lost-pixel): archived.
- [BackstopJS](https://github.com/garris/BackstopJS), [Resemble.js](https://github.com/rsmbl/Resemble.js): references, `diffBounds`.
- [reg-suit](https://github.com/reg-viz/reg-suit), [notifier](https://github.com/reg-viz/reg-suit/tree/master/packages/reg-notify-github-plugin): git-hash baselines, PR approval.
- [Storybook change detection](https://storybook.js.org/docs/configure/user-interface/change-detection): dev-only.
- [Romano et al., ICSE 2021](https://arxiv.org/abs/2103.02669): UI flakiness causes.
- [Zhang et al., 2026](https://arxiv.org/abs/2607.01728): limits of pixel diffs.
- [Mahajan & Halfond, ICST 2015](https://computer.org/csdl/proceedings-article/icst/2015/07102586/12OmNyjccCu): WebSee.
