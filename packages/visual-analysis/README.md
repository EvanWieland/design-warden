# @design-warden/visual-analysis

Part of [Design Warden](https://www.npmjs.com/package/design-warden), which checks frontend pull requests against a design-system policy. Install `design-warden` for the command line; you rarely need this package directly.

This package captures the policy's routes and states with Playwright (`@design-warden/visual-analysis/capture`, the only module that loads it), compares base and head captures pixel by pixel, labels changed regions, and optionally runs axe-core accessibility checks. A visual difference requests review; it never fails a build.

MIT licensed.
