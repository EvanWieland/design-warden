import { inScope, ruleScope, type LoadedPolicy } from '@design-warden/core';
import { analyzeSource } from '@design-warden/source-analysis';

export interface ExampleResult {
  ruleId: string;
  file: string;
  expect: 'pass' | 'fail';
  ok: boolean;
  detail: string;
}

/**
 * Runs every rule's examples through the rule's real check and options, so a policy author
 * can see that a rule catches what it should and nothing else. Only deterministic source
 * checks are executable; other examples are reported as not runnable.
 */
export async function testPolicyExamples(loaded: LoadedPolicy): Promise<ExampleResult[]> {
  const { policy } = loaded;
  const results: ExampleResult[] = [];
  for (const rule of policy.rules) {
    for (const ex of rule.examples) {
      const base = { ruleId: rule.id, file: ex.file, expect: ex.expect };
      if (rule.verify.by !== 'check') {
        results.push({ ...base, ok: true, detail: `not runnable (verified by ${rule.verify.by})` });
        continue;
      }
      const { include, exclude } = ruleScope(policy, rule);
      if (!inScope(ex.file, include, exclude)) {
        results.push({ ...base, ok: false, detail: 'example file is outside the rule scope, so the rule would never see it' });
        continue;
      }
      const { drafts } = await analyzeSource({ loaded, virtualFiles: [{ path: ex.file, text: ex.code }], onlyRules: [rule.id] });
      // Only the example's own findings: the token sources are analyzed too, and may break the rule themselves.
      const hits = drafts.filter((d) => d.ruleId === rule.id && d.location?.file === ex.file && d.verdict !== 'notice' && !d.inlineSuppression);
      const ok = ex.expect === 'fail' ? hits.length > 0 : hits.length === 0;
      results.push({ ...base, ok, detail: hits.length ? hits.map((h) => h.message).join(' | ') : 'no findings' });
    }
  }
  return results;
}
