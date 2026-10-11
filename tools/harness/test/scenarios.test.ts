import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appliedScenario, applyScenario, listScenarios, resetDemo, runScenario } from '../src/index.ts';
import { DEMO_DIR } from '../src/scenarios.ts';

const scenarios = listScenarios();

describe('seeded scenarios (deterministic engines)', () => {
  it('has the brief\'s eight cases plus a clean baseline and two security cases', () => {
    expect(scenarios.map((s) => s.id)).toEqual([
      'compliant-change',
      'hardcoded-color',
      'unapproved-spacing',
      'raw-control',
      'incomplete-state',
      'custom-reimplementation',
      'token-change',
      'new-pattern',
      'insufficient-evidence',
      'agent-evasion',
      'policy-weakening',
    ]);
  });

  it.each(scenarios.map((s) => [s.id, s.expected.outcome]))('%s -> %s, with exactly the expected findings', async (id) => {
    const run = await runScenario(id);
    expect(run.mismatches).toEqual([]);
  });

  it('never rejects the legitimate new pattern', async () => {
    const run = await runScenario('new-pattern');
    expect(run.report.summary.byOutcome.fail).toBe(0);
    expect(run.report.provenance.find((p) => p.component === 'ActivityTimeline')).toMatchObject({ classification: 'novel' });
  });
});

describe('semantic review through the full pipeline (recorded responses)', () => {
  it('accepts the verifiable observation and rejects fabricated or unknown findings', async () => {
    const run = await runScenario('agent-evasion', { semantic: 'replay' });
    expect(run.mismatches).toEqual([]);
    expect(run.report.semantic).toMatchObject({ provider: 'replay', accepted: 1, endpoint: undefined });
    expect(run.report.semantic!.rejected.map((r) => r.reason)).toEqual([
      'quoted text not found in the file (fabricated evidence)',
      'unknown or non-semantic rule "approve-all"',
    ]);
    const ai = run.report.findings.filter((f) => f.origin === 'ai');
    expect(ai).toEqual([expect.objectContaining({ ruleId: 'semantic/advisory', outcome: 'info', location: { file: 'src/components/PromoRibbon.tsx', line: 3 } })]);
  });

  it('a supportive model verdict is informational and does not change the outcome', async () => {
    const run = await runScenario('new-pattern', { semantic: 'replay' });
    expect(run.report.outcome).toBe('review');
    expect(run.report.findings.find((f) => f.origin === 'ai')).toMatchObject({ verdict: 'acceptable-deviation', outcome: 'info', ruleId: 'patterns/justified-novelty' });
  });
});

describe('apply and reset', () => {
  // Works on a private copy of the demo: other test files copy apps/demo in parallel.
  const copy = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-apply-'));
    fs.cpSync(DEMO_DIR, dir, { recursive: true, filter: (src) => !['node_modules', 'dist'].includes(path.basename(src)) });
    return dir;
  };
  const snapshot = (dir: string) => {
    const h = createHash('sha256');
    for (const f of fs.globSync('**/*', { cwd: dir }).sort()) {
      const abs = path.join(dir, f);
      h.update(f); // directories too: reset must not leave empty ones behind
      if (fs.statSync(abs).isFile()) h.update(fs.readFileSync(abs));
    }
    return h.digest('hex');
  };

  it('applies a scenario to a demo checkout and restores it byte for byte', () => {
    const dir = copy();
    expect(appliedScenario(dir)).toBeNull();
    const before = snapshot(dir);
    try {
      applyScenario('incomplete-state', dir);
      expect(fs.existsSync(path.join(dir, 'src/pages/CustomersPage.tsx'))).toBe(true);
      expect(snapshot(dir)).not.toBe(before);
      expect(() => applyScenario('hardcoded-color', dir)).toThrow(/already applied/);
    } finally {
      resetDemo(dir);
    }
    expect(snapshot(dir)).toBe(before);
    expect(appliedScenario(dir)).toBeNull();
  });

  it('removes the directories a scenario created', () => {
    const dir = copy();
    const before = snapshot(dir);
    applyScenario('new-pattern', dir); // adds src/components/, which the demo does not have
    expect(fs.existsSync(path.join(dir, 'src/components/ActivityTimeline.tsx'))).toBe(true);
    resetDemo(dir);
    expect(fs.existsSync(path.join(dir, 'src/components'))).toBe(false);
    expect(snapshot(dir)).toBe(before);
  });
});
