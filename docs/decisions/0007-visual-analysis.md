# ADR 0007: Deterministic capture with the Playwright library; pixelmatch 8 with clustering

Status: Accepted, 2026-10-10

## Context

See [visual-regression.md](../research/visual-regression.md):

- `toHaveScreenshot` throws outside the Playwright test runner.
- Default thresholds (0.1 in pixelmatch, 0.2 in Playwright) report **zero** changed pixels for adjacent token shades.
- Rendering differs across environments (headless vs headed: 784 px on one page).
- Committed baselines need per-platform images and an approval workflow.

## Decision

- `design-warden capture` drives `playwright` directly with one fixed preset:
  - `deviceScaleFactor` 1, `reducedMotion: reduce`, UTC, `en-US`, service workers blocked;
  - `clock.setFixedTime`, a seeded `Math.random`;
  - every request outside the app's origin aborted;
  - animations disabled, caret hidden, `document.fonts.ready`;
  - screenshots retaken until two consecutive ones are identical.
- Routes, states and viewports come from the policy. Interactions use the closed action vocabulary.
- Each capture writes a manifest with an environment fingerprint (Playwright version, browser, headless mode, platform, DPR) and the labelled boxes of up to 1,500 elements.
- `check --visual-base/--visual-head` compares two capture directories with pixelmatch 8 (exact pin) at threshold 0.02. Noise is removed by 8 px grid clustering (≥4 pixels per cell, ≥24 per region), never by raising the threshold.
- Each region is labelled with the smallest captured element that contains it.
- Comparison is refused when fingerprints differ.
- The recommended setup captures base and head in the same job on the same machine. Committed baselines work too (added later): a capture directory committed with the code, compared like any base capture. The fingerprint check refuses one captured in another environment, and the error says how to fix it (docs/ci-integration.md, "Committed baselines").
- Findings: one per route/state with changes, verdict `insufficient-evidence` ("changed; confirm it is intended"). Enforcement comes from the rule (`review` in the demo).

## Consequences

- No baseline storage and no approval service. Results reproduce on one machine.
- CI must build the base revision, which costs time in large monorepos.
- Element labels from production builds may be less meaningful than source-level component names.
- Region-to-source hints (added 2026-10-11): each changed screen's finding names up to three stylesheet rules that use the class of its largest change's element, as a heuristic, from a lookup the CLI passes in, so visual-analysis still does not depend on source analysis. They are code evidence in other files, so finding ids ignore them (ADR 0012).

## Alternatives considered

- **odiff:** native binaries, and only one bounding box.
- **Chromatic / Percy / Argos:** hosted review workflows. Complementary, not reused.
- **Playwright's internal comparator:** private API.
