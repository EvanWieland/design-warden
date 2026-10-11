import type { ChangeScope } from './finalize.ts';
import type { Box, EngineId, Finding, FindingCategory, Origin, Outcome } from './findings.ts';
import type { EngineStatus, OverallOutcome } from './outcome.ts';
import type { Severity } from './policy/schema.ts';

export type ProvenanceClass = 'established' | 'modified' | 'novel' | 'insufficient-evidence';

/** Where a changed component's structure comes from (ADR 0009). */
export interface ProvenanceRecord {
  file: string;
  component: string;
  line: number;
  endLine: number;
  classification: ProvenanceClass;
  nearest?: { kind: 'pattern' | 'component'; id: string; source: string; similarity: number };
  signals: {
    designSystemComponents: string[];
    rawElements: string[];
    elementCount: number;
    /** Constructs static analysis cannot see through, e.g. spread props or computed styles. */
    dynamic: string[];
  };
  explanation: string;
}

export interface VisualDiffSummary {
  capture: string; // route/state/viewport
  route: string;
  state: string;
  viewport: string;
  status: 'unchanged' | 'changed' | 'added' | 'removed' | 'size-changed' | 'error';
  changedPixels: number;
  changedRatio: number;
  regions: Box[];
  /** Paths relative to the report's artifact directory. */
  images: { before?: string; after?: string; diff?: string };
  error?: string;
}

export interface SemanticSummary {
  provider: string;
  model?: string;
  endpoint?: string;
  /** What went into the request. With `dryRun`, the request was written to a file and not sent. */
  dataSent: { files: string[]; characters: number; screenshots: number; redactions: number };
  dryRun?: boolean;
  accepted: number;
  downgraded: number;
  rejected: { reason: string; ruleId?: string; file?: string; line?: number; message?: string }[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface Summary {
  total: number;
  byOutcome: Record<Outcome, number>;
  byCategory: Partial<Record<FindingCategory, number>>;
  bySeverity: Record<Severity, number>;
  byOrigin: Record<Origin, number>;
  suppressed: number;
  preexisting: number;
}

export interface Report {
  reportVersion: 1;
  tool: { name: 'design-warden'; version: string };
  generatedAt: string;
  durationMs: number;
  policy: { name: string; revision: string; path: string; sha256: string; source: string };
  /** `only`: the report holds, and the outcome counts, only this engine's findings (`--only`). */
  target: { root: string; base: { ref: string; sha: string } | null; scope: ChangeScope; changedFiles: string[]; only?: EngineId };
  outcome: OverallOutcome;
  outcomeReasons: string[];
  exitCode: number;
  summary: Summary;
  engines: EngineStatus[];
  findings: Finding[];
  provenance: ProvenanceRecord[];
  visual?: { diffs: VisualDiffSummary[]; artifactDir?: string };
  semantic?: SemanticSummary;
}

/**
 * Untrusted text (source snippets, file names, model output) for line-oriented output:
 * no control characters, escape sequences or line breaks, so it cannot start a new
 * CI workflow command or rewrite the terminal.
 */
export const oneLine = (s: string): string => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ');

/** Counts only findings that affect the outcome; suppressed and pre-existing ones are counted separately. */
export function summarize(findings: Finding[]): Summary {
  const s: Summary = {
    total: 0,
    byOutcome: { fail: 0, review: 0, info: 0 },
    byCategory: {},
    bySeverity: { error: 0, warning: 0, info: 0 },
    byOrigin: { deterministic: 0, heuristic: 0, ai: 0 },
    suppressed: 0,
    preexisting: 0,
  };
  for (const f of findings) {
    if (f.suppressed) s.suppressed++;
    else if (f.preexisting) s.preexisting++;
    else {
      s.total++;
      s.byOutcome[f.outcome]++;
      s.byCategory[f.category] = (s.byCategory[f.category] ?? 0) + 1;
      s.bySeverity[f.severity]++;
      s.byOrigin[f.origin]++;
    }
  }
  return s;
}
