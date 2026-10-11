import { describe, expect, it } from 'vitest';
import { evaluateBenchmark } from '../src/eval.ts';

describe('deterministic benchmark', () => {
  // Regression guard for known false positives and negatives. If a change fixes one or adds one,
  // this fails on purpose: update the labels and docs/evaluation.md together.
  it('matches the documented baseline exactly', async () => {
    const r = await evaluateBenchmark();
    expect(r.mismatches).toEqual([
      'false negative: typography/scale at src/bench/typography.css:18 (1)',
      'false positive: components/reuse-existing at src/bench/Duplicates.tsx:37 (1)',
    ]);
    expect(r.overall).toMatchObject({ tp: 140, fp: 1, fn: 1 });
    expect(r.locationMisses).toBe(0);
  });
});
