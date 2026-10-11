import type { Enforcement, FailureMode } from './policy/schema.ts';
import type { EngineId, Finding, Outcome } from './findings.ts';

export type OverallOutcome = 'pass' | 'review' | 'fail' | 'error';
export type EngineStatusKind = 'completed' | 'skipped' | 'failed' | 'incomplete';

export interface EngineStatus {
  engine: EngineId;
  status: EngineStatusKind;
  /** Why the engine was skipped, failed or incomplete. Always set unless completed. */
  reason?: string;
  durationMs?: number;
}

/** Process exit codes. Documented in docs/ci-integration.md; treat as a stable contract. */
export const EXIT_CODES = {
  pass: 0,
  review: 0, // 1 with --fail-on review
  fail: 1,
  usage: 2, // invalid policy, bad arguments, unknown git ref
  error: 3, // an engine failed and its failure mode is fail-closed
} as const;

const RANK: Record<Outcome, number> = { info: 0, review: 1, fail: 2 };
const ENFORCEMENT_CEILING: Record<Enforcement, Outcome> = { block: 'fail', review: 'review', report: 'info' };
const lower = (a: Outcome, b: Outcome): Outcome => (RANK[a] <= RANK[b] ? a : b);

type OutcomeInput = Pick<Finding, 'verdict' | 'enforcement' | 'category' | 'origin' | 'suppressed' | 'preexisting'> & {
  /** An owner's approval of this finding (ADR 0012). It clears a review request only. */
  approval?: { reason: string; approvedBy: string };
};

/**
 * The single place where a finding becomes a CI consequence (ADR 0005).
 * Confidence is deliberately not an input: blocking depends on the verdict and the
 * rule's enforcement, never on a model's self-reported certainty.
 */
export function decideOutcome(f: OutcomeInput): { outcome: Outcome; reason: string; approved: boolean } {
  if (f.suppressed) return { outcome: 'info', reason: `suppressed by ${f.suppressed.by}: ${f.suppressed.reason}`, approved: false };
  if (f.preexisting) return { outcome: 'info', reason: 'pre-existing: outside the lines changed by this change set', approved: false };

  const ceiling = ENFORCEMENT_CEILING[f.enforcement];
  let outcome: Outcome;
  let reason: string;
  switch (f.verdict) {
    case 'violation':
      outcome = ceiling;
      reason = `confirmed violation of a ${f.category} rule (enforcement: ${f.enforcement})`;
      break;
    case 'probable-violation':
      outcome = lower(ceiling, 'review');
      reason = 'probable violation; a human should confirm';
      break;
    case 'insufficient-evidence':
      outcome = lower(ceiling, 'review');
      reason = 'not enough evidence to decide; a human should review';
      break;
    case 'acceptable-deviation':
      outcome = 'info';
      reason = 'deviation judged reasonable; informational';
      break;
    case 'notice':
      outcome = 'info';
      reason = 'informational';
      break;
  }
  if (f.origin === 'ai' && outcome === 'fail') {
    outcome = 'review';
    reason += '; model findings can request review but never block';
  }
  // An approval never touches a blocking finding: that needs a policy exception or a fix.
  if (f.approval && outcome === 'review') return { outcome: 'info', reason: `approved by ${f.approval.approvedBy}: ${f.approval.reason}`, approved: true };
  return { outcome, reason, approved: false };
}

export function overallOutcome(
  findings: Pick<Finding, 'outcome'>[],
  engines: EngineStatus[],
  failurePolicy: Record<'source' | 'visual' | 'semantic', FailureMode>,
): { outcome: OverallOutcome; reasons: string[] } {
  const reasons: string[] = [];
  let failedClosed = false;
  let failedReview = false;
  for (const e of engines) {
    if (e.status !== 'failed' || e.engine === 'policy') continue;
    const mode = failurePolicy[e.engine];
    reasons.push(`${e.engine} engine failed (${mode}): ${e.reason ?? 'unknown error'}`);
    if (mode === 'fail-closed') failedClosed = true;
    if (mode === 'review') failedReview = true;
  }
  const count = (o: Outcome) => findings.filter((f) => f.outcome === o).length;
  const fails = count('fail');
  const reviews = count('review');
  if (fails) reasons.push(`${fails} blocking finding(s)`);
  if (reviews) reasons.push(`${reviews} finding(s) need human review`);

  // An engine that fails closed means the result is unknown, which outranks any finding.
  const outcome: OverallOutcome = failedClosed ? 'error' : fails ? 'fail' : reviews || failedReview ? 'review' : 'pass';
  if (outcome === 'pass') reasons.push('no blocking or review findings');
  return { outcome, reasons };
}

export function exitCodeFor(outcome: OverallOutcome, failOn: 'fail' | 'review' = 'fail'): number {
  if (outcome === 'review') return failOn === 'review' ? EXIT_CODES.fail : EXIT_CODES.review;
  return EXIT_CODES[outcome];
}
