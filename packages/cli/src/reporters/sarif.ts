import type { Finding, Report } from '@design-warden/core';

type Level = 'error' | 'warning' | 'note';
const LEVEL: Record<Finding['outcome'], Level> = { fail: 'error', review: 'warning', info: 'note' };
const SEVERITY_LEVEL: Record<Finding['severity'], Level> = { error: 'error', warning: 'warning', info: 'note' };

/** A project-relative path made relative to where the check ran (the repository root in CI). */
export const repoPath = (root: string, file: string): string => (root === '.' || root.startsWith('..') || /^([a-z]:)?\//i.test(root) ? file : `${root}/${file}`);

const uri = (root: string, file: string) => repoPath(root, file).split('/').map(encodeURIComponent).join('/');

/**
 * SARIF 2.1.0 for code scanning (docs/ci-integration.md). It holds what Design Warden gates on:
 * suppressed and pre-existing findings are left out. Only plain-text fields are written, never
 * `markdown`, because messages carry repository and model text.
 */
export function renderSarif(report: Report): string {
  const findings = report.findings.filter((f) => !f.suppressed && !f.preexisting);
  const ruleIds = [...new Set(findings.map((f) => f.ruleId))];
  const rules = ruleIds.map((id) => {
    const first = findings.find((f) => f.ruleId === id)!;
    // A model may override remediation per finding; the rule's help shows the policy's text only.
    const remediation = findings.find((f) => f.ruleId === id && f.origin !== 'ai')?.remediation;
    const helpUri = first.guidance.map((g) => g.url).find((u) => u && /^https?:\/\//i.test(u));
    const refs = first.guidance.map((g) => [g.title, g.url ?? [g.path, g.section].filter(Boolean).join(' > ')].filter(Boolean).join(': '));
    const help = [remediation, ...refs].filter(Boolean).join('\n');
    return {
      id,
      shortDescription: { text: first.title },
      ...(first.rationale ? { fullDescription: { text: first.rationale } } : {}),
      ...(help ? { help: { text: help } } : {}),
      ...(helpUri ? { helpUri } : {}),
      defaultConfiguration: { level: SEVERITY_LEVEL[first.severity] },
      properties: { category: first.category, tags: ['design-warden', first.category] },
    };
  });
  const results = findings.map((f) => {
    const fix = f.suggestion ?? (f.outcome !== 'info' ? f.remediation : undefined);
    const loc = f.location;
    return {
      ruleId: f.ruleId,
      ruleIndex: ruleIds.indexOf(f.ruleId),
      level: LEVEL[f.outcome],
      message: { text: `${f.origin === 'ai' ? '(AI) ' : ''}${f.message}${fix ? `\n${fix}` : ''}` },
      locations: loc
        ? [
            {
              physicalLocation: {
                artifactLocation: { uri: uri(report.target.root, loc.file) },
                region: { startLine: loc.line, ...(loc.column ? { startColumn: loc.column } : {}), ...(loc.endLine && loc.endLine > loc.line ? { endLine: loc.endLine } : {}) },
              },
            },
          ]
        : [],
      // The finding id hashes rule, file and evidence text, so it survives edits that shift lines.
      partialFingerprints: { 'designWarden/v1': f.id },
      properties: { outcome: f.outcome, verdict: f.verdict, origin: f.origin, confidence: f.confidence, engine: f.engine },
    };
  });
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [{ tool: { driver: { name: report.tool.name, version: report.tool.version, rules } }, columnKind: 'utf16CodeUnits', results }],
    },
    null,
    2,
  );
}
