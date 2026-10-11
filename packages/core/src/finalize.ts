import { createHash } from 'node:crypto';
import { isLineChanged, type ChangeSet } from './changes.ts';
import type { Finding, FindingDraft, GuidanceRef, Location, Outcome } from './findings.ts';
import { decideOutcome } from './outcome.ts';
import { compareText, matchesAny } from './paths.ts';
import { ruleMeta } from './policy/builtin.ts';
import type { Policy, PolicyException } from './policy/schema.ts';

export type ChangeScope = 'changed-lines' | 'changed-files' | 'all';

export interface FinalizeOptions {
  policy: Policy;
  /** Without a change set every finding counts (full scan). */
  changes?: ChangeSet;
  scope: ChangeScope;
  /** YYYY-MM-DD, used for exception expiry. Injected so results are reproducible. */
  today: string;
}

const OUTCOME_ORDER: Record<Outcome, number> = { fail: 0, review: 1, info: 2 };

/** Attaches policy metadata, exceptions, change scoping and outcomes to engine drafts. */
export function finalizeFindings(drafts: FindingDraft[], opts: FinalizeOptions): Finding[] {
  const { policy } = opts;
  const active = policy.exceptions.filter((e) => !e.expires || e.expires >= opts.today);
  const expired = policy.exceptions.filter((e) => e.expires && e.expires < opts.today);
  const approvals = policy.approvals.filter((a) => a.expires >= opts.today);
  const all = [...drafts, ...expired.map(expiredDraft)];
  const seen = new Map<string, number>();

  const findings = all.map((d): Finding => {
    const meta = ruleMeta(policy, d.ruleId);
    if (!meta) throw new Error(`finding references unknown rule "${d.ruleId}"`);
    const exception = d.location && active.find((e) => e.rules.includes(d.ruleId) && matchesAny(d.location!.file, e.paths));
    const suppressed = d.inlineSuppression
      ? { by: 'inline' as const, reason: d.inlineSuppression.reason }
      : exception
        ? { by: 'exception' as const, reason: exception.reason, exceptionId: exception.id }
        : undefined;
    const preexisting = isPreexisting(d.location, opts);
    const f = {
      ruleId: d.ruleId,
      ruleVersion: meta.version,
      check: d.check,
      title: meta.title,
      category: meta.category,
      severity: meta.severity,
      enforcement: meta.enforcement,
      confidence: d.confidence,
      verdict: d.verdict,
      origin: d.origin,
      engine: d.engine,
      message: d.message,
      location: d.location,
      evidence: d.evidence ?? [],
      guidance: resolveGuidance(policy, [...meta.guidance, ...(d.guidance ?? [])]),
      rationale: meta.rationale,
      remediation: d.remediation ?? meta.remediation,
      suggestion: d.suggestion,
      suppressed,
      preexisting: preexisting || undefined,
    };
    const id = fingerprint({ ...f, spanText: d.spanText }, seen);
    const approval = approvals.find((a) => a.fingerprint === id && a.rule === f.ruleId && a.file === f.location?.file);
    const { outcome, reason, approved } = decideOutcome({ ...f, approval });
    return { id, ...f, ...(approved && approval && { suppressed: { by: 'approval' as const, reason: approval.reason, approvedBy: approval.approvedBy } }), outcome, outcomeReason: reason };
  });

  return findings.sort(
    (a, b) =>
      OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
      compareText(a.location?.file ?? '', b.location?.file ?? '') ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0) ||
      compareText(a.ruleId, b.ruleId),
  );
}

function isPreexisting(loc: Location | undefined, opts: FinalizeOptions): boolean {
  if (!opts.changes || opts.scope === 'all' || !loc) return false;
  const change = opts.changes.files.find((f) => f.path === loc.file);
  if (!change) return true;
  if (opts.scope === 'changed-files' || change.status === 'added') return false;
  return !isLineChanged(change, loc.line, loc.endLine ?? loc.line);
}

function resolveGuidance(policy: Policy, keys: string[]): GuidanceRef[] {
  return [...new Set(keys)].flatMap((id) => {
    const g = policy.guidance[id];
    return g ? [{ id, ...g }] : [];
  });
}

const expiredDraft = (e: PolicyException): FindingDraft => ({
  ruleId: 'policy/exception-expired',
  verdict: 'violation',
  confidence: 'high',
  origin: 'deterministic',
  engine: 'policy',
  message: `Exception "${e.id}" for ${e.rules.join(', ')} expired on ${e.expires}; it no longer applies.`,
  evidence: [{ kind: 'note', text: `Reason given: ${e.reason}` }],
});

/**
 * Stable id for annotations and run-to-run comparison: rule + file + evidence text,
 * so it survives unrelated edits that shift line numbers.
 */
function fingerprint(f: Pick<Finding, 'ruleId' | 'location' | 'evidence' | 'message'> & { spanText?: string }, seen: Map<string, number>): string {
  const code = f.evidence.find((e) => e.kind === 'code');
  const text = code?.kind === 'code' ? code.snippet.replace(/\s+/g, ' ').trim() : f.message;
  // A multi-line span (a whole element or component) is hashed whole, so an edit anywhere in it changes the id.
  const span = f.spanText ? `\0${f.spanText.replace(/\s+/g, ' ').trim()}` : '';
  const base = createHash('sha256')
    .update(`${f.ruleId}\0${f.location?.file ?? ''}\0${text}${span}`)
    .digest('hex')
    .slice(0, 16);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}
