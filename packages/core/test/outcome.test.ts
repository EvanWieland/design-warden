import { describe, expect, it } from 'vitest';
import { decideOutcome, exitCodeFor, overallOutcome, type EngineStatus } from '../src/index.ts';

const base = { category: 'mandatory', origin: 'deterministic', enforcement: 'block' } as const;
const policy = { source: 'fail-closed', visual: 'review', semantic: 'review' } as const;

describe('decideOutcome', () => {
  it.each([
    ['violation', 'block', 'fail'],
    ['violation', 'review', 'review'],
    ['violation', 'report', 'info'],
    ['probable-violation', 'block', 'review'],
    ['probable-violation', 'report', 'info'],
    ['insufficient-evidence', 'block', 'review'],
    ['acceptable-deviation', 'block', 'info'],
    ['notice', 'block', 'info'],
  ] as const)('%s with enforcement %s -> %s', (verdict, enforcement, expected) => {
    expect(decideOutcome({ ...base, verdict, enforcement }).outcome).toBe(expected);
  });

  it('never lets a model finding block', () => {
    const r = decideOutcome({ ...base, verdict: 'violation', origin: 'ai' });
    expect(r.outcome).toBe('review');
    expect(r.reason).toMatch(/never block/);
  });

  it('lets an approval clear a review request, never a blocking or informational finding (ADR 0012)', () => {
    const approval = { reason: 'accepted in design review', approvedBy: 'ds' };
    expect(decideOutcome({ ...base, verdict: 'insufficient-evidence', approval })).toMatchObject({ outcome: 'info', approved: true, reason: 'approved by ds: accepted in design review' });
    expect(decideOutcome({ ...base, verdict: 'violation', approval })).toMatchObject({ outcome: 'fail', approved: false });
    expect(decideOutcome({ ...base, verdict: 'notice', approval })).toMatchObject({ outcome: 'info', approved: false });
  });

  it('suppressed and pre-existing findings are informational', () => {
    expect(decideOutcome({ ...base, verdict: 'violation', suppressed: { by: 'exception', reason: 'x' } }).outcome).toBe('info');
    expect(decideOutcome({ ...base, verdict: 'violation', preexisting: true }).outcome).toBe('info');
  });
});

describe('overallOutcome', () => {
  const done = (engine: EngineStatus['engine']): EngineStatus => ({ engine, status: 'completed' });

  it('passes when nothing needs attention', () => {
    expect(overallOutcome([{ outcome: 'info' }], [done('source')], policy).outcome).toBe('pass');
  });

  it('fails on a blocking finding and reviews on a review finding', () => {
    expect(overallOutcome([{ outcome: 'fail' }, { outcome: 'review' }], [done('source')], policy).outcome).toBe('fail');
    expect(overallOutcome([{ outcome: 'review' }], [done('source')], policy).outcome).toBe('review');
  });

  it('a fail-closed engine failure outranks findings', () => {
    const r = overallOutcome([{ outcome: 'fail' }], [{ engine: 'source', status: 'failed', reason: 'parser crashed' }], policy);
    expect(r.outcome).toBe('error');
    expect(r.reasons.join(' ')).toMatch(/parser crashed/);
  });

  it('a failed optional engine requests review instead of silently passing', () => {
    const r = overallOutcome([], [done('source'), { engine: 'semantic', status: 'failed', reason: 'timeout' }], policy);
    expect(r.outcome).toBe('review');
  });

  it('fail-open records the failure without changing the outcome', () => {
    const r = overallOutcome([], [{ engine: 'semantic', status: 'failed', reason: 'timeout' }], { ...policy, semantic: 'fail-open' });
    expect(r.outcome).toBe('pass');
    expect(r.reasons[0]).toMatch(/semantic engine failed \(fail-open\)/);
  });

  it('skipped engines do not affect the outcome', () => {
    expect(overallOutcome([], [{ engine: 'visual', status: 'skipped', reason: 'not configured' }], policy).outcome).toBe('pass');
  });
});

describe('exitCodeFor', () => {
  it('maps outcomes to the documented exit codes', () => {
    expect([exitCodeFor('pass'), exitCodeFor('review'), exitCodeFor('fail'), exitCodeFor('error')]).toEqual([0, 0, 1, 3]);
    expect(exitCodeFor('review', 'review')).toBe(1);
  });
});
