import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, makeProject, TEST_POLICY } from '../../source-analysis/test/helpers.ts';

// Simulates a crash inside the deterministic engine.
vi.mock('@design-warden/source-analysis', async (original) => ({
  ...(await original<typeof import('@design-warden/source-analysis')>()),
  analyzeSource: () => Promise.reject(new Error('parser exploded')),
}));
const { main } = await import('../src/index.ts');

afterAll(cleanup);

describe('engine failure handling', () => {
  it('fails closed (exit 3) when the source engine cannot run', async () => {
    const { root } = makeProject({});
    const policyPath = path.join(root, 'design-warden.policy.json');
    fs.writeFileSync(policyPath, JSON.stringify(TEST_POLICY));
    const out: string[] = [];
    const code = await main(['check', '--policy', policyPath], (s) => out.push(s), () => {});
    expect(code).toBe(3);
    expect(out.join('\n')).toContain('Result: ERROR');
    expect(out.join('\n')).toContain('source engine failed (fail-closed): parser exploded');
    // "No findings." above an error read as a clean result (Excalidraw trial).
    expect(out.join('\n')).not.toContain('No findings.');
    expect(out.join('\n')).toContain('No findings from the engines that completed.');
  });

  it.each([
    ['sarif', 'No SARIF written'],
    ['gitlab', 'No Code Quality report written'],
  ])('writes no %s report when an engine failed closed, so an incomplete run cannot read as fixed issues', async (format, message) => {
    const { root } = makeProject({});
    const policyPath = path.join(root, 'design-warden.policy.json');
    fs.writeFileSync(policyPath, JSON.stringify(TEST_POLICY));
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['check', '--policy', policyPath, '--format', format], (s) => out.push(s), (s) => err.push(s));
    expect(code).toBe(3);
    expect(out).toEqual([]);
    expect(err.join('\n')).toContain(message);
  });

  it('writes no SARIF either when the failed engine fails open, because the result is still incomplete', async () => {
    const { root } = makeProject({});
    const policyPath = path.join(root, 'design-warden.policy.json');
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, failurePolicy: { source: 'fail-open' } }));
    const out: string[] = [];
    const err: string[] = [];
    await main(['check', '--policy', policyPath, '--format', 'sarif'], (s) => out.push(s), (s) => err.push(s));
    expect(out).toEqual([]);
    expect(err.join('\n')).toContain('No SARIF written: the source engine failed: parser exploded');
  });

  it('fails open only when the policy says so, and still reports the failure', async () => {
    const { root } = makeProject({});
    const policyPath = path.join(root, 'design-warden.policy.json');
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, failurePolicy: { source: 'fail-open' } }));
    const out: string[] = [];
    const code = await main(['check', '--policy', policyPath, '--format', 'json'], (s) => out.push(s), () => {});
    const report = JSON.parse(out.join('\n'));
    expect(code).toBe(0);
    expect(report.engines[0]).toMatchObject({ engine: 'source', status: 'failed', reason: 'parser exploded' });
    expect(report.outcomeReasons[0]).toBe('source engine failed (fail-open): parser exploded');
  });
});
