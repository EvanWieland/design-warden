import { oneLine, type Finding, type Report } from '@design-warden/core';

const ICON: Record<Report['outcome'], string> = { pass: '✅ Pass', review: '🟡 Review requested', fail: '❌ Fail', error: '⚠️ Error' };
const OUTCOME: Record<Finding['outcome'], string> = { fail: '🔴 fail', review: '🟡 review', info: 'ℹ️ info' };

/**
 * Escapes text for markdown table cells. Findings can contain model output and repository
 * text, so link, image and HTML syntax is neutralised (rendered links could exfiltrate data).
 */
const ZWSP = String.fromCharCode(0x200b); // zero-width space

/** Text of a field that should be text: strings, numbers and booleans. Anything else (a forged object) renders as nothing. */
const text = (s: unknown) => (typeof s === 'string' ? s : typeof s === 'number' || typeof s === 'boolean' ? String(s) : '');

export const md = (s: unknown) =>
  oneLine(text(s))
    .replace(/[\\`*_[\]()<>|!#]/g, (c) => `\\${c}`)
    // GitHub autolinks bare URLs and www. names even in escaped text; a zero-width space breaks them.
    .replace(/:\/\//g, `:/${ZWSP}/`)
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}${ZWSP}.`)
    // @user and @org/team would notify people from the account that posts the comment.
    .replace(/@/g, `@${ZWSP}`)
    .slice(0, 400);

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const label = <K extends string>(table: Record<K, string>, key: unknown) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key as K] : md(key));
/** Rule ids are policy-defined names; anything else is shown as escaped text, never in a code span it could close. */
const ruleId = (id: unknown) => (typeof id === 'string' && /^[\w./:@-]+$/.test(id) ? `\`${id}\`` : md(id));

/**
 * Markdown summary for a CI job summary or a PR comment. Every field is escaped or checked, because
 * a comment can render a report written by another job (the visual job builds pull-request code).
 */
export function renderMarkdown(report: Report, maxRows = 50): string {
  const c = report.summary;
  const rows = report.findings.filter((f) => !f.suppressed && !f.preexisting);
  const lines = [
    `## Design Warden${report.target.only ? ` (${md(report.target.only)} only)` : ''}: ${label(ICON, report.outcome)}`,
    '',
    `**${num(c.byOutcome?.fail)} blocking** · ${num(c.byOutcome?.review)} need review · ${num(c.byOutcome?.info)} info · ${num(c.suppressed)} suppressed · ${num(c.preexisting)} pre-existing — policy *${md(report.policy.name)}* rev ${md(report.policy.revision)} (${md(report.policy.source)})`,
    '',
  ];
  if (rows.length) {
    lines.push('| Outcome | Rule | Location | Finding |', '|---|---|---|---|');
    for (const f of rows.slice(0, maxRows)) {
      // File names come from the repository: escape them too (a name can contain markdown).
      const where = f.location ? `${md(f.location.file)}:${num(f.location.line)}` : '—';
      const origin = f.origin === 'ai' ? ' *(AI)*' : f.origin === 'heuristic' ? ' *(heuristic)*' : '';
      const fix = f.suggestion ?? (f.outcome !== 'info' ? f.remediation : undefined);
      lines.push(`| ${label(OUTCOME, f.outcome)} | ${ruleId(f.ruleId)}${origin} | ${where} | ${md(f.message)}${fix ? `<br>→ ${md(fix)}` : ''} |`);
    }
    if (rows.length > maxRows) lines.push('', `…and ${rows.length - maxRows} more in the JSON report.`);
  } else {
    lines.push('No findings that need attention.');
  }
  lines.push('', '<details><summary>Engines</summary>', '');
  const engines = report.engines.slice(0, 10); // a forged report could list thousands
  for (const e of engines) lines.push(`- **${md(e.engine)}**: ${md(e.status)}${e.reason ? ` — ${md(e.reason)}` : ''}${typeof e.durationMs === 'number' ? ` (${num(e.durationMs)} ms)` : ''}`);
  if (report.engines.length > engines.length) lines.push(`- …and ${report.engines.length - engines.length} more engine(s) in the JSON report`);
  if (report.semantic) {
    const s = report.semantic;
    lines.push(
      s.dryRun
        ? `- semantic review dry run: ${num(s.dataSent?.files?.length)} file(s) written to a request file; nothing was sent.`
        : `- semantic review sent ${num(s.dataSent?.files?.length)} file(s) to ${md(s.endpoint ?? 'no network (local replay)')}; accepted ${num(s.accepted)}, downgraded ${num(s.downgraded)}, rejected ${num(s.rejected?.length)}. AI findings never block.`,
    );
  }
  lines.push('', '</details>', '');
  if (report.outcome === 'review') lines.push('> A review request does not fail the build by default. A design-system owner should confirm the items above before merging.');
  return lines.join('\n');
}
