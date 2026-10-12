import { styleText } from 'node:util';
import { oneLine, type Finding, type Report } from '@design-warden/core';

type Style = Parameters<typeof styleText>[0];
const paint = (style: Style, text: string) => styleText(style, text, { stream: process.stdout });

const LABEL: Record<Finding['outcome'], [string, Style]> = {
  fail: ['FAIL  ', ['red', 'bold']],
  review: ['REVIEW', ['yellow', 'bold']],
  info: ['INFO  ', 'cyan'],
};
const ORIGIN: Record<Finding['origin'], string> = { deterministic: '', heuristic: ' [heuristic]', ai: ' [AI]' };
const OVERALL: Record<Report['outcome'], Style> = { pass: ['green', 'bold'], review: ['yellow', 'bold'], fail: ['red', 'bold'], error: ['magenta', 'bold'] };

/** Concise human report. Pre-existing and suppressed findings are counted, not listed, unless verbose. */
export function renderTerminal(report: Report, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  const p = report.policy;
  // Every string from the report may contain repository or model text: render each as one plain line.
  const t = oneLine;
  out.push(paint('bold', `Design Warden ${report.tool.version}`) + paint('dim', ` · ${t(p.name)} (rev ${t(p.revision)}, ${t(p.source)})`));
  out.push(
    paint(
      'dim',
      report.target.base
        ? `Changes: ${report.target.changedFiles.length} file(s) vs ${t(report.target.base.ref)}${report.target.base.sha ? ` (merge base ${report.target.base.sha.slice(0, 8)})` : ''} · scope: ${report.target.scope}`
        : 'Full scan (no --base): every finding counts',
    ),
  );
  if (report.target.only) out.push(paint('dim', `Only ${report.target.only} findings are reported and counted (--only)`));
  out.push('');

  const shown = report.findings.filter((f) => opts.verbose || (!f.suppressed && !f.preexisting));
  const failed = report.engines.some((e) => e.status === 'failed');
  if (!shown.length) out.push(failed ? paint('yellow', '  No findings from the engines that completed.') : paint('green', '  No findings.'));
  for (const f of shown) {
    const [label, style] = LABEL[f.outcome];
    const where = f.location ? `${t(f.location.file)}:${f.location.line}${f.location.column ? `:${f.location.column}` : ''}` : '(project)';
    const tags = `${ORIGIN[f.origin]}${f.suppressed ? ` [suppressed: ${f.suppressed.by}]` : ''}${f.preexisting ? ' [pre-existing]' : ''}`;
    out.push(`  ${paint(style, label)} ${paint('bold', t(f.ruleId))}  ${where}${paint('dim', tags)}`);
    out.push(`         ${t(f.message)}`);
    for (const e of f.evidence) {
      if (e.kind === 'token-change') out.push(paint('dim', `         ${t(e.token)}${e.selector ? ` (${t(e.selector)})` : ""}: ${t(e.before ?? '(none)')} -> ${t(e.after ?? '(removed)')} · ${e.usages.length} usage(s)`));
      if (e.kind === 'note' && f.engine !== 'source') out.push(paint('dim', `         ${t(e.text)}`));
    }
    if (f.suggestion) out.push(paint('green', `         -> ${t(f.suggestion)}`));
    else if (f.outcome !== 'info' && f.remediation) out.push(paint('green', `         -> ${t(f.remediation)}`));
    const g = f.guidance[0];
    if (g) out.push(paint('dim', `         Guidance: ${t(g.title)}${g.path ? ` (${t(g.path)}${g.section ? ` > ${t(g.section)}` : ''})` : g.url ? ` (${t(g.url)})` : ''}`));
  }

  if (shown.length > 10) {
    const byRule = new Map<string, number>();
    for (const f of shown) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
    out.push('', `By rule: ${[...byRule].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${t(r)} ${n}`).join(' · ')}`);
  }
  out.push('');
  out.push(
    'Engines: ' +
      report.engines
        .map((e) => {
          const s = e.status === 'completed' ? paint('green', 'ok') : e.status === 'skipped' ? paint('dim', 'skipped') : paint(['yellow', 'bold'], e.status.toUpperCase());
          return `${e.engine} ${s}${e.durationMs !== undefined ? paint('dim', ` ${e.durationMs} ms`) : ''}${e.reason && e.status !== 'completed' ? paint('dim', ` (${t(e.reason)})`) : ''}`;
        })
        .join(' · '),
  );
  if (report.semantic) {
    const s = report.semantic;
    out.push(
      paint('dim', `Semantic review: ${t(s.provider)}${s.model ? ` / ${t(s.model)}` : ''}${s.endpoint ? ` -> ${t(s.endpoint)}` : ' (no network)'}; ${s.dataSent.files.length} file(s) ${s.dryRun ? 'in the request (dry run, not sent)' : 'sent'}; accepted ${s.accepted}, downgraded ${s.downgraded}, rejected ${s.rejected.length}`),
    );
  }
  const c = report.summary;
  out.push(
    `${paint(OVERALL[report.outcome], `Result: ${report.outcome.toUpperCase()}`)} - ${c.byOutcome.fail} blocking, ${c.byOutcome.review} need review, ${c.byOutcome.info} info` +
      paint('dim', ` (${c.suppressed} suppressed, ${c.preexisting} pre-existing) · exit ${report.exitCode}`),
  );
  if (report.outcome === 'error' || report.outcome === 'review') for (const r of report.outcomeReasons) out.push(paint('dim', `  - ${t(r)}`));
  return out.join('\n');
}
