import type { FindingCategory } from '../findings.ts';
import { CATEGORY_DEFAULTS, type Enforcement, type Policy, type PolicyRule, type Severity } from './schema.ts';

export interface RuleMeta {
  title: string;
  category: FindingCategory;
  severity: Severity;
  enforcement: Enforcement;
  rationale: string;
  remediation: string;
  version?: number;
  guidance: string[];
}

/**
 * Rules that are always on and cannot be configured, because a change must not be
 * able to switch off the checks that watch the policy itself.
 */
export const BUILTIN_RULES: Record<string, RuleMeta> = {
  'policy/changed': {
    title: 'Design policy changed',
    category: 'governance',
    severity: 'warning',
    enforcement: 'review',
    rationale: 'Editing the policy changes what is enforced, so it needs review by the policy owners.',
    remediation: 'Ask a policy owner to review the policy change. In CI, load the policy from the base branch (--policy-ref).',
    guidance: [],
  },
  'policy/exception-expired': {
    title: 'Policy exception expired',
    category: 'governance',
    severity: 'warning',
    enforcement: 'review',
    rationale: 'Exceptions are time-boxed so that temporary deviations do not become permanent by default.',
    remediation: 'Fix the excepted code, or renew the exception with a new expiry date and reason.',
    guidance: [],
  },
  'policy/inline-exception-rejected': {
    title: 'Inline exception rejected',
    category: 'governance',
    severity: 'warning',
    enforcement: 'review',
    rationale:
      'Inline exceptions must name one rule and give a reason, and cannot silence mandatory or required-pattern rules unless the policy allows it.',
    remediation: 'Fix the underlying finding, or add a reviewed exception to the policy file.',
    guidance: [],
  },
  'analysis/unparseable-file': {
    title: 'File could not be analyzed',
    category: 'governance',
    severity: 'warning',
    enforcement: 'review',
    rationale: 'A file that cannot be parsed has not been checked; treating it as compliant would hide violations.',
    remediation: 'Fix the syntax error, or exclude the file from the policy scope if it is not application code.',
    guidance: [],
  },
  'semantic/advisory': {
    title: 'Advisory design observation',
    category: 'advisory',
    severity: 'info',
    enforcement: 'report',
    rationale: 'Observations from semantic review that are not tied to a specific policy rule.',
    remediation: 'Consider the observation; no action is required.',
    guidance: [],
  },
};

/** A rule's effective file scope: its own include (or the project's), minus project and rule excludes. */
export function ruleScope(policy: Policy, rule: PolicyRule): { include: string[]; exclude: string[] } {
  return { include: rule.scope?.include ?? policy.project.include, exclude: [...policy.project.exclude, ...(rule.scope?.exclude ?? [])] };
}

export function ruleMeta(policy: Policy, ruleId: string): RuleMeta | undefined {
  const r = policy.rules.find((x) => x.id === ruleId);
  if (!r) return BUILTIN_RULES[ruleId];
  const d = CATEGORY_DEFAULTS[r.category];
  return {
    title: r.title,
    category: r.category,
    severity: r.severity ?? d.severity,
    enforcement: r.enforcement ?? d.enforcement,
    rationale: r.rationale,
    remediation: r.remediation,
    version: r.version,
    guidance: r.guidance,
  };
}
