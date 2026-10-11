import { oneLine, type Finding, type Report } from '@design-warden/core';

const ICON: Record<Report['outcome'], string> = { pass: '✅ Pass', review: '🟡 Review requested', fail: '❌ Fail', error: '⚠️ Error' };
const OUTCOME: Record<Finding['outcome'], string> = { fail: '🔴 fail', review: '🟡 review', info: 'ℹ️ info' };

/**
 * Escapes text for markdown table cells. Findings can contain model output and repository
 * text, so link, image and HTML syntax is neutralised (rendered links could exfiltrate data).
 */
const ZWSP = String.fromCharCode(0x200b); // zero-width space

export const md = (s: string) =>
  oneLine(s)
    .replace(/[\\`*_[\]()<>|!#]/g, (c) => `\\${c}`)
    // GitHub autolinks bare URLs and www. names even in escaped text; a zero-width space breaks them.
    .replace(/:\/\//g, `:/${ZWSP}/`)
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}${ZWSP}.`)
    .slice(0, 400);

/** Markdown summary for a CI job summary or a PR comment. */
export function renderMarkdown(report: Report, maxRows = 50): string {
  const c = report.summary;
  const rows = report.findings.filter((f) => !f.suppressed && !f.preexisting);
  const lines = [
    `## Design Warden${report.target.only ? ` (${report.target.only} only)` : ''}: ${ICON[report.outcome]}`,
    '',
    `**${c.byOutcome.fail} blocking** · ${c.byOutcome.review} need review · ${c.byOutcome.info} info · ${c.suppressed} suppressed · ${c.preexisting} pre-existing — policy *${md(report.policy.name)}* rev ${md(report.policy.revision)} (${md(report.policy.source)})`,
    '',
  ];
  if (rows.length) {
    lines.push('| Outcome | Rule | Location | Finding |', '|---|---|---|---|');
    for (const f of rows.slice(0, maxRows)) {
      // File names come from the repository: escape them too (a name can contain markdown).
      const where = f.location ? md(`${f.location.file}:${f.location.line}`) : '—';
      const origin = f.origin === 'ai' ? ' *(AI)*' : f.origin === 'heuristic' ? ' *(heuristic)*' : '';
      const fix = f.suggestion ?? (f.outcome !== 'info' ? f.remediation : undefined);
      lines.push(`| ${OUTCOME[f.outcome]} | \`${f.ruleId}\`${origin} | ${where} | ${md(f.message)}${fix ? `<br>→ ${md(fix)}` : ''} |`);
    }
    if (rows.length > maxRows) lines.push('', `…and ${rows.length - maxRows} more in the JSON report.`);
  } else {
    lines.push('No findings that need attention.');
  }
  lines.push('', '<details><summary>Engines</summary>', '');
  for (const e of report.engines) lines.push(`- **${e.engine}**: ${e.status}${e.reason ? ` — ${md(e.reason)}` : ''}${e.durationMs !== undefined ? ` (${e.durationMs} ms)` : ''}`);
  if (report.semantic) {
    const s = report.semantic;
    lines.push(
      s.dryRun
        ? `- semantic review dry run: ${s.dataSent.files.length} file(s) written to a request file; nothing was sent.`
        : `- semantic review sent ${s.dataSent.files.length} file(s) to ${md(s.endpoint ?? 'no network (local replay)')}; accepted ${s.accepted}, downgraded ${s.downgraded}, rejected ${s.rejected.length}. AI findings never block.`,
    );
  }
  lines.push('', '</details>', '');
  if (report.outcome === 'review') lines.push('> A review request does not fail the build by default. A design-system owner should confirm the items above before merging.');
  return lines.join('\n');
}
