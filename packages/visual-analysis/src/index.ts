// Capture lives in './capture' so that importing this entry point never loads Playwright.
export { compareCaptures, readCapturePair, visualDiffCheck, VisualError, type CompareInput, type StyleHint, type VisualDiffOptions } from './compare.ts';
export { changedRegions, type RegionOptions } from './regions.ts';
export * from './manifest.ts';
export { accessibilityCheck, accessibilityDrafts, type AccessibilityOptions } from './accessibility.ts';
