import { oneLine, type Finding, type Report } from '@design-warden/core';
import { repoPath } from './sarif.ts';

const SEVERITY: Record<Finding['outcome'], 'major' | 'minor' | 'info'> = { fail: 'major', review: 'minor', info: 'info' };

/**
 * GitLab Code Quality report: the Code Climate subset GitLab reads (docs/ci-integration.md).
 * Like SARIF it holds the findings that count toward the outcome. GitLab needs a file and a
 * line for every issue, so findings without a location are left out.
 */
export function renderGitlab(report: Report): string {
  const issues = report.findings
    .filter((f) => !f.suppressed && !f.preexisting && f.location)
    .map((f) => {
      const fix = f.suggestion ?? (f.outcome !== 'info' ? f.remediation : undefined);
      return {
        description: oneLine(`${f.origin === 'ai' ? '(AI) ' : ''}${f.message}${fix ? ` ${fix}` : ''}`),
        check_name: f.ruleId,
        fingerprint: f.id,
        severity: SEVERITY[f.outcome],
        location: { path: repoPath(report.target.root, f.location!.file), lines: { begin: f.location!.line } },
      };
    });
  return JSON.stringify(issues, null, 2);
}
