import type { Report } from '@design-warden/core';
import { UsageError } from '../analyze.ts';
import { md, renderMarkdown } from './markdown.ts';

/** First line of the comment; the workflow updates the comment that starts with it instead of adding one per push. */
const COMMENT_MARKER = '<!-- design-warden -->';
/** GitHub's comment limit, minus room for the footer the workflow appends. */
const MAX_LENGTH = 65_536 - 1_000;

/** The job a report came from, named by the workflow: it decides the section title, whatever the report claims. */
export type CommentSection = 'check' | 'visual' | 'semantic';
const ONLY: Record<CommentSection, Report['target']['only']> = { check: undefined, visual: 'visual', semantic: 'semantic' };

/** One section of the comment: a report, or the reason a report could not be read. */
export type CommentPart = { section?: CommentSection; report: Report } | { section?: CommentSection; unreadable: string };

/** `check=report.json`, `visual=…` or `semantic=…`; a bare path is titled by the report itself. */
export function parseSectionArg(arg: string): { section?: CommentSection; file: string } {
  const m = /^(\w+)=(.+)$/s.exec(arg);
  if (!m) return { file: arg };
  if (!Object.hasOwn(ONLY, m[1]!)) throw new UsageError(`unknown comment section "${m[1]}" (use check, visual or semantic)`);
  return { section: m[1] as CommentSection, file: m[2]! };
}

/**
 * A saved JSON report, checked for the shape the markdown renderer reads. Reports can come from
 * other CI jobs, including one that builds pull-request code, so they are data: the renderer escapes
 * every field, and this only rejects what is not a report at all.
 */
export function parseReport(text: string, file: string): Report {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON (${(e as Error).message})`);
  }
  const r = value as Record<string, unknown> | null;
  if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new UsageError(`${file} does not contain a JSON object`);
  if (r.reportVersion !== 1) throw new UsageError(`${file} is not a Design Warden report: expected "reportVersion": 1, found ${JSON.stringify(r.reportVersion) ?? 'none'}`);
  const isObject = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x);
  for (const key of ['findings', 'engines']) {
    if (!Array.isArray(r[key]) || !(r[key] as unknown[]).every(isObject)) throw new UsageError(`${file} is not a Design Warden report: "${key}" must be an array of objects`);
  }
  for (const key of ['summary', 'policy', 'target']) {
    if (!isObject(r[key])) throw new UsageError(`${file} is not a Design Warden report: "${key}" must be an object`);
  }
  return value as Report;
}

/** One pull-request comment from saved reports, in the order given, with fewer table rows per report until it fits. */
export function renderComment(parts: CommentPart[]): string {
  const section = (p: CommentPart, rows: number) => {
    if ('unreadable' in p) {
      const only = p.section && ONLY[p.section];
      return `## Design Warden${only ? ` (${only} only)` : ''}: report unreadable\n\n${md(p.unreadable)}`;
    }
    const report = p.section ? { ...p.report, target: { ...p.report.target, only: ONLY[p.section] } } : p.report;
    return renderMarkdown(report, rows);
  };
  let body = '';
  for (const rows of [50, 20, 10, 5, 0]) {
    body = `${COMMENT_MARKER}\n${parts.map((p) => section(p, rows)).join('\n\n---\n\n')}`;
    if (body.length <= MAX_LENGTH) break;
  }
  return body;
}
