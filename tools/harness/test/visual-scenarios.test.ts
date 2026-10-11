import { describe, expect, it } from 'vitest';
import { runScenario } from '../src/index.ts';

// Builds the demo twice with Vite and captures 16 states each in Chromium (about 20 s cold).
describe('visual analysis on the demo (real builds, real browser)', () => {
  it('shows a token change on every affected screen and labels the changed regions', async () => {
    const run = await runScenario('token-change', { visual: true });
    const changed = run.report.visual!.diffs.filter((d) => d.status === 'changed');
    expect(changed.length).toBeGreaterThanOrEqual(8);
    expect(changed.every((d) => d.regions.length > 0 && d.images.diff)).toBe(true);
    expect(run.report.findings.filter((f) => f.engine === 'visual').every((f) => f.outcome === 'review')).toBe(true);
    expect(run.report.outcome).toBe('review');
    // The dependency junction used for builds is not part of the change.
    expect(run.report.target.changedFiles).toEqual(['src/design-system/tokens.css']);
  }, 240_000);

  it('reports no difference when the change is not visible (no flakiness between builds)', async () => {
    const run = await runScenario('unapproved-spacing', { visual: true });
    expect(run.report.visual!.diffs.map((d) => d.status)).toEqual(Array(16).fill('unchanged'));
  }, 240_000);
});
