import type { Enforcement, RuleCategory, Severity } from './policy/schema.ts';

/** Policy categories plus `governance`, used only by built-in rules about the policy itself. */
export type FindingCategory = RuleCategory | 'governance';
/** How sure the producing engine is. Independent of severity (how bad) and enforcement (what CI does). */
export type Confidence = 'high' | 'medium' | 'low';
export type Verdict =
  | 'violation' // confirmed: the evidence shows the rule is broken
  | 'probable-violation' // likely broken; a human should confirm
  | 'acceptable-deviation' // differs from established practice for a plausible reason
  | 'insufficient-evidence' // cannot decide from the available evidence
  | 'notice'; // informational observation, nothing to fix
/** deterministic: exact analysis. heuristic: deterministic but approximate. ai: produced by a model. */
export type Origin = 'deterministic' | 'heuristic' | 'ai';
export type EngineId = 'source' | 'visual' | 'semantic' | 'policy';
export type Outcome = 'fail' | 'review' | 'info';

export interface Location {
  file: string; // POSIX path relative to the project root
  line: number; // 1-based
  column?: number; // 1-based
  endLine?: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nearest captured element, e.g. `table.ds-table`, when known. */
  label?: string;
}

export type Evidence =
  | { kind: 'code'; file: string; line: number; snippet: string }
  | { kind: 'token-change'; token: string; before: string | null; after: string | null; usages: string[] }
  | { kind: 'usage'; file: string; line: number; detail: string }
  | { kind: 'screenshot'; capture: string; region?: Box; before?: string; after?: string; diff?: string }
  | { kind: 'note'; text: string };

export interface GuidanceRef {
  id: string;
  title: string;
  path?: string;
  section?: string;
  url?: string;
}

/** What an engine reports. Policy metadata and the outcome are attached by `finalizeFindings`. */
export interface FindingDraft {
  ruleId: string;
  check?: string;
  verdict: Verdict;
  confidence: Confidence;
  origin: Origin;
  engine: EngineId;
  message: string;
  location?: Location;
  evidence?: Evidence[];
  /** A concrete, machine-derived fix such as "use var(--color-text-danger)". Never auto-applied. */
  suggestion?: string;
  /** Overrides the rule's remediation text for this finding. */
  remediation?: string;
  /** Extra guidance keys beyond the rule's own (e.g. cited by a model and verified). */
  guidance?: string[];
  /** The text of a multi-line flagged span. Not reported; it makes the stable id change when any line of the span does. */
  spanText?: string;
  /** Set by engines that honour inline `design-warden-ignore-next-line` comments. */
  inlineSuppression?: { reason: string };
}

export interface Finding {
  id: string;
  ruleId: string;
  ruleVersion?: number;
  check?: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  enforcement: Enforcement;
  confidence: Confidence;
  verdict: Verdict;
  origin: Origin;
  engine: EngineId;
  message: string;
  location?: Location;
  evidence: Evidence[];
  guidance: GuidanceRef[];
  rationale?: string;
  remediation?: string;
  suggestion?: string;
  outcome: Outcome;
  outcomeReason: string;
  suppressed?: { by: 'exception' | 'inline' | 'approval'; reason: string; exceptionId?: string; approvedBy?: string };
  /** True when the finding lies outside the lines (or files) changed by the change set. */
  preexisting?: boolean;
}
