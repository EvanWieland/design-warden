import fs from 'node:fs';
import path from 'node:path';
import { toPosix, type Finding, type Report } from '@design-warden/core';
import { renderMarkdown } from './markdown.ts';

const LEVEL: Record<Finding['outcome'], 'error' | 'warning' | 'notice'> = { fail: 'error', review: 'warning', info: 'notice' };
/** GitHub shows at most 10 annotations per level per step (docs/research/ci-integration.md). */
const PER_LEVEL = 10;

// Workflow-command escaping, as in @actions/core.
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * Annotation commands for the most important findings. File paths are converted to be
 * relative to the workspace and checked against the file on disk; a finding whose path
 * or line cannot be validated is annotated without a location instead of a wrong one.
 */
export function githubAnnotations(report: Report, projectRoot: string, workspace: string): { commands: string[]; omitted: number } {
  const counts = { error: 0, warning: 0, notice: 0 };
  const seen = new Set<string>();
  const commands: string[] = [];
  let omitted = 0;
  for (const f of report.findings) {
    if (f.suppressed || f.preexisting || seen.has(f.id)) continue;
    seen.add(f.id);
    const level = LEVEL[f.outcome];
    if (counts[level] >= PER_LEVEL) {
      omitted++;
      continue;
    }
    counts[level]++;
    const props = [`title=${escapeProperty(`${f.ruleId}${f.origin === 'ai' ? ' (AI)' : ''}: ${f.title}`)}`];
    const loc = f.location && validLocation(projectRoot, workspace, f.location.file, f.location.line);
    if (loc) props.unshift(`file=${escapeProperty(loc)}`, `line=${f.location!.line}`, ...(f.location!.column ? [`col=${f.location!.column}`] : []));
    const fix = f.suggestion ?? (f.outcome !== 'info' ? f.remediation : undefined);
    commands.push(`::${level} ${props.join(',')}::${escapeData(`${f.message}${fix ? `\n${fix}` : ''}`)}`);
  }
  return { commands, omitted };
}

function validLocation(projectRoot: string, workspace: string, file: string, line: number): string | null {
  const abs = path.resolve(projectRoot, file);
  const rel = path.relative(workspace, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) return null;
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/).length;
  return line >= 1 && line <= lines ? toPosix(rel) : null;
}

/** Writes annotations to stdout, the summary to $GITHUB_STEP_SUMMARY and outputs to $GITHUB_OUTPUT when set. */
export function emitGithub(report: Report, projectRoot: string, write: (s: string) => void): void {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const { commands, omitted } = githubAnnotations(report, projectRoot, workspace);
  for (const c of commands) write(c);
  if (omitted) write(`::notice title=Design Warden::${omitted} more finding(s) are not annotated; see the job summary or the JSON report.`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) fs.appendFileSync(summaryFile, `${renderMarkdown(report).slice(0, 900_000)}\n`);
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const s = report.summary.byOutcome;
    fs.appendFileSync(outputFile, `outcome=${report.outcome}\nexit-code=${report.exitCode}\nblocking=${s.fail}\nreview=${s.review}\n`);
  }
}
