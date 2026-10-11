import type { CheckDefinition, FindingDraft } from '@design-warden/core';
import { z } from 'zod';
import type { CaptureManifest } from './manifest.ts';

const options = z.strictObject({
  // axe-core rule tags; the default is WCAG 2.x levels A and AA.
  tags: z.array(z.string().min(1)).min(1).default(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']),
});
export type AccessibilityOptions = z.output<typeof options>;

export const accessibilityCheck: CheckDefinition = {
  id: 'accessibility',
  engine: 'visual',
  description: 'Runs axe-core on every captured state and reports violations that are new in head; review only.',
  options,
};

/**
 * One draft per axe rule and state with violations on elements that the base capture did not have.
 * Automated results need a human in context, so they are probable violations: at most a review request.
 * A state axe could not check, and captures checked differently (another axe-core version or other
 * tags, or not at all), are insufficient evidence.
 */
export function accessibilityDrafts(base: CaptureManifest, head: CaptureManifest, ruleId: string): FindingDraft[] {
  const common = { ruleId, check: 'accessibility', origin: 'deterministic' as const, engine: 'visual' as const, confidence: 'high' as const };
  const ran = (m: CaptureManifest) => (m.axe ? `axe-core ${m.axe.version} (${[...m.axe.tags].sort().join(', ')})` : 'no accessibility checks');
  if (!head.axe) return [{ ...common, verdict: 'insufficient-evidence', message: 'Accessibility was not checked: the head captures were made without axe-core. Capture them with a policy that has an accessibility rule.' }];
  if (ran(base) !== ran(head)) {
    return [{ ...common, verdict: 'insufficient-evidence', message: `Accessibility results were not compared: base was captured with ${ran(base)}, head with ${ran(head)}. Capture both with the same tags and axe-core version.` }];
  }
  // Elements are matched by their HTML, counted: axe's selectors use positions (nth-child), which shift when unrelated markup changes.
  const before = new Map(
    base.captures.map((c) => {
      const counts = new Map<string, number>();
      for (const v of c.accessibility ?? []) for (const n of v.nodes) counts.set(`${v.rule}|${n.html}`, (counts.get(`${v.rule}|${n.html}`) ?? 0) + 1);
      return [c.id, counts];
    }),
  );
  const drafts: FindingDraft[] = [];
  for (const c of head.captures) {
    const where = `${c.route}/${c.state} (${c.viewport})`;
    if (c.accessibilityError) {
      drafts.push({ ...common, verdict: 'insufficient-evidence', message: `Accessibility of ${where} was not checked: ${c.accessibilityError}.` });
      continue;
    }
    const counts = before.get(c.id) ?? new Map<string, number>();
    for (const v of c.accessibility ?? []) {
      const added = v.nodes
        .filter((n) => {
          const left = counts.get(`${v.rule}|${n.html}`) ?? 0;
          counts.set(`${v.rule}|${n.html}`, left - 1);
          return left <= 0;
        })
        .map((n) => n.target);
      if (!added.length) continue;
      const list = added.slice(0, 5).map((t) => `\`${t}\``).join(', ');
      drafts.push({
        ...common,
        verdict: 'probable-violation',
        message: `${v.rule}${v.impact ? ` (${v.impact})` : ''} on ${where}: ${v.help}. New on ${added.length} element(s): ${list}${added.length > 5 ? ', …' : ''}.`,
        evidence: [{ kind: 'note', text: `axe-core rule ${v.rule}: ${v.helpUrl}` }],
      });
    }
  }
  return drafts;
}
