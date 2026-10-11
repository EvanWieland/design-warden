import { describe, expect, it } from 'vitest';
import { MalformedResponseError, sanitize, verifyResponse, type VerifyContext } from '../src/index.ts';

const ctx: VerifyContext = {
  semanticRules: new Set(['layout/one-primary-action', 'states/complete']),
  guidanceIds: new Set(['patterns', 'states']),
  files: new Map([['src/pages/Orders.tsx', ['import x;', '', '  <Button variant="primary">Save</Button>', '  <Button variant="primary">Export</Button>', 'end']]]),
  maxFindings: 25,
};

const finding = (over: Record<string, unknown> = {}) => ({
  ruleId: 'layout/one-primary-action',
  verdict: 'violation',
  confidence: 'high',
  file: 'src/pages/Orders.tsx',
  line: 4,
  quote: '<Button variant="primary">Export</Button>',
  explanation: 'Two primary buttons compete for attention.',
  guidance: ['patterns'],
  remediation: 'Make Export secondary.',
  ...over,
});
const verify = (...findings: object[]) => verifyResponse(JSON.stringify({ findings }), ctx);

describe('verifyResponse', () => {
  it('accepts a finding whose quote matches the cited line', () => {
    const v = verify(finding());
    expect(v.accepted).toBe(1);
    expect(v.drafts[0]).toMatchObject({
      ruleId: 'layout/one-primary-action',
      origin: 'ai',
      engine: 'semantic',
      verdict: 'violation',
      confidence: 'high',
      location: { file: 'src/pages/Orders.tsx', line: 4 },
      guidance: ['patterns'],
    });
  });

  it('normalises enum casing and maps "advisory" to the built-in advisory rule', () => {
    const v = verify(finding({ ruleId: 'Advisory', verdict: 'Probable-Violation', confidence: 'HIGH' }));
    expect(v.drafts[0]).toMatchObject({ ruleId: 'semantic/advisory', verdict: 'probable-violation', confidence: 'high' });
  });

  it.each([
    [{ ruleId: 'color/semantic-tokens' }, /unknown or non-semantic rule/],
    [{ file: 'src/secret.ts' }, /not part of the review/],
    [{ line: 99 }, /outside the file/],
    [{ quote: 'this text appears nowhere in the file' }, /fabricated evidence/],
    [{ file: '', line: 7 }, /line number given without a file/],
    [{ verdict: 'approve' }, /unknown verdict/],
    [{ line: '4' }, /schema/],
  ])('rejects %o', (over, reason) => {
    const v = verify(finding(over));
    expect(v.accepted).toBe(0);
    expect(v.rejected[0]?.reason).toMatch(reason);
  });

  it('corrects a wrong line number when the quote is found elsewhere, and lowers confidence', () => {
    const v = verify(finding({ line: 3 }));
    expect(v.drafts[0]).toMatchObject({ location: { line: 4 }, confidence: 'medium' });
    expect(v.downgraded).toBe(1);
    expect(JSON.stringify(v.drafts[0]!.evidence)).toContain('corrected from 3 to 4');
  });

  it('downgrades findings without a verifiable quote to insufficient evidence', () => {
    const v = verify(finding({ quote: '' }));
    expect(v.drafts[0]).toMatchObject({ verdict: 'insufficient-evidence', confidence: 'low' });
  });

  it('drops unknown guidance references', () => {
    const v = verify(finding({ guidance: ['patterns', 'made-up'] }));
    expect(v.drafts[0]!.guidance).toEqual(['patterns']);
    expect(v.downgraded).toBe(1);
  });

  it('caps the number of accepted findings', () => {
    const v = verifyResponse(JSON.stringify({ findings: Array.from({ length: 30 }, () => finding()) }), ctx);
    expect(v.accepted).toBe(25);
    expect(v.rejected.filter((r) => r.reason === 'over the finding limit')).toHaveLength(5);
  });

  it('fails closed on malformed responses', () => {
    expect(() => verifyResponse('not json', ctx)).toThrow(MalformedResponseError);
    expect(() => verifyResponse('{"result": []}', ctx)).toThrow(/no "findings" array/);
  });
});

describe('sanitize', () => {
  it('strips links, images and control characters from model text', () => {
    expect(sanitize('See ![x](https://evil.example/leak?d=secret) and [docs](http://a.b) or https://c.d/e\u0007', 500)).toBe(
      'See x and docs or [link removed]',
    );
  });
});
