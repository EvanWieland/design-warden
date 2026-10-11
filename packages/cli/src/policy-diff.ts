import { CATEGORY_DEFAULTS, type Enforcement, type RuleCategory } from '@design-warden/core';

interface RuleLike {
  id?: string;
  category?: RuleCategory;
  enforcement?: Enforcement;
  verify?: unknown;
  scope?: unknown;
}

const STRENGTH: Record<Enforcement, number> = { block: 2, review: 1, report: 0 };

/** Human-readable rule-level differences between two policy texts, with weakening called out. */
export function policyChangeNotes(baseText: string | null, headText: string | null): string[] {
  if (baseText === null) return ['The policy file is new in this change.'];
  if (headText === null) return ['The policy file was deleted.'];
  let base: { rules?: RuleLike[]; exceptions?: { id?: string }[]; approvals?: { fingerprint?: string; rule?: string; file?: string }[] };
  let head: typeof base;
  try {
    [base, head] = [JSON.parse(baseText), JSON.parse(headText)];
  } catch {
    return ['One version of the policy is not valid JSON; compare the files manually.'];
  }
  const notes: string[] = [];
  const byId = (rules: RuleLike[] = []) => new Map(rules.map((r) => [r.id ?? '?', r]));
  const [b, h] = [byId(base.rules), byId(head.rules)];
  const enforcement = (r: RuleLike) => r.enforcement ?? (r.category ? CATEGORY_DEFAULTS[r.category]?.enforcement : undefined) ?? 'report';

  for (const [id, r] of b) {
    const n = h.get(id);
    if (!n) {
      notes.push(`Rule ${id} was removed${enforcement(r) === 'block' ? ' (it was blocking)' : ''}.`);
      continue;
    }
    const [from, to] = [enforcement(r), enforcement(n)];
    if (from !== to) notes.push(`Rule ${id}: enforcement ${from} -> ${to}${STRENGTH[to] < STRENGTH[from] ? ' (weakened)' : ''}.`);
    if (r.category !== n.category) notes.push(`Rule ${id}: category ${r.category} -> ${n.category}.`);
    if (JSON.stringify(r.verify) !== JSON.stringify(n.verify)) notes.push(`Rule ${id}: verification or options changed.`);
    if (JSON.stringify(r.scope) !== JSON.stringify(n.scope)) notes.push(`Rule ${id}: scope changed.`);
  }
  for (const id of h.keys()) if (!b.has(id)) notes.push(`Rule ${id} was added.`);
  const exById = (p: typeof base) => new Map((p.exceptions ?? []).map((e) => [e.id ?? '?', JSON.stringify(e)]));
  const [be, he] = [exById(base), exById(head)];
  for (const [id, e] of he) {
    if (!be.has(id)) notes.push(`Exception ${id} was added.`);
    else if (be.get(id) !== e) notes.push(`Exception ${id} changed (scope, rules, reason or expiry).`);
  }
  for (const id of be.keys()) if (!he.has(id)) notes.push(`Exception ${id} was removed.`);
  // Approvals clear review requests; each one is named so a reviewer can see what is being accepted.
  // Compared by content, so a second entry for a fingerprint cannot hide behind the first.
  const label = (a: { rule?: string; file?: string; fingerprint?: string }) => `Approval for ${a.rule}${a.file ? ` at ${a.file}` : ''} (${a.fingerprint})`;
  const [ba, ha] = [base.approvals ?? [], head.approvals ?? []];
  const [bs, hs] = [new Set(ba.map((a) => JSON.stringify(a))), new Set(ha.map((a) => JSON.stringify(a)))];
  const fps = (list: typeof ba) => new Set(list.map((a) => a.fingerprint));
  for (const a of ha) if (!bs.has(JSON.stringify(a))) notes.push(`${label(a)} ${fps(ba).has(a.fingerprint) ? 'changed' : 'was added'}.`);
  for (const a of ba) if (!hs.has(JSON.stringify(a)) && !fps(ha).has(a.fingerprint)) notes.push(`${label(a)} was removed.`);
  // Every other section can also widen or narrow what is checked (scope, registry, tokens, limits).
  const record = (p: object) => p as Record<string, unknown>;
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (key === 'rules' || key === 'exceptions' || key === 'approvals' || key === 'revision' || key === '$schema') continue;
    if (JSON.stringify(record(base)[key]) !== JSON.stringify(record(head)[key])) notes.push(`Policy section "${key}" changed.`);
  }
  return notes;
}
