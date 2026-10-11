import fs from 'node:fs';
import path from 'node:path';
import { ALL_CHECKS } from '@design-warden/cli';
import { compareText, loadPolicyFile, type FindingDraft } from '@design-warden/core';
import { analyzeSource } from '@design-warden/source-analysis';
import { DEMO_DIR, POLICY_FILE, REPO_ROOT } from './scenarios.ts';

export const BENCHMARK_DIR = path.join(REPO_ROOT, 'fixtures', 'benchmark');

export interface RuleScore {
  ruleId: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export interface BenchmarkResult {
  files: number;
  expected: number;
  reported: number;
  rules: RuleScore[];
  overall: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null };
  /** Findings of the right rule within two lines of an expectation, but not on it. */
  locationMisses: number;
  insufficientEvidenceRate: number;
  durationMs: number;
  mismatches: string[];
}

// Marker: "@expect <rule-id>" optionally followed by "x<count>", anywhere on the line where the finding is expected.
const MARKER = /@expect\s+([a-z0-9/.-]+)(?:\s+x(\d+))?/g;

/**
 * Deterministic benchmark (docs/evaluation.md): runs the source engine with the demo policy
 * over a labelled corpus and scores each rule by exact (rule, file, line) matches.
 * Model-based review is evaluated separately (semantic-eval.ts), never here.
 */
export async function evaluateBenchmark(): Promise<BenchmarkResult> {
  const loaded = loadPolicyFile(path.join(DEMO_DIR, POLICY_FILE), ALL_CHECKS);
  const corpus = fs
    .globSync('src/**/*.{ts,tsx,css,scss,vue,svelte}', { cwd: BENCHMARK_DIR })
    .map((f) => f.split(path.sep).join('/'))
    .sort()
    .map((p) => ({ path: p, text: fs.readFileSync(path.join(BENCHMARK_DIR, p), 'utf8') }));

  const expected = new Map<string, number>(); // "rule|file|line" -> count
  for (const f of corpus) {
    f.text.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(MARKER)) {
        const key = `${m[1]}|${f.path}|${i + 1}`;
        expected.set(key, (expected.get(key) ?? 0) + Number(m[2] ?? 1));
      }
    });
  }

  const started = performance.now();
  const { drafts } = await analyzeSource({ loaded, virtualFiles: corpus });
  const durationMs = Math.round(performance.now() - started);

  const counted = drafts.filter((d): d is FindingDraft & { location: NonNullable<FindingDraft['location']> } => !!d.location && !d.inlineSuppression && d.verdict !== 'notice');
  const actual = new Map<string, number>();
  for (const d of counted) {
    const key = `${d.ruleId}|${d.location.file}|${d.location.line}`;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  const scores = new Map<string, { tp: number; fp: number; fn: number }>();
  const score = (rule: string) => scores.get(rule) ?? scores.set(rule, { tp: 0, fp: 0, fn: 0 }).get(rule)!;
  const mismatches: string[] = [];
  let locationMisses = 0;
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const [rule, file, line] = key.split('|') as [string, string, string];
    const [e, a] = [expected.get(key) ?? 0, actual.get(key) ?? 0];
    const s = score(rule);
    s.tp += Math.min(e, a);
    if (a > e) {
      s.fp += a - e;
      mismatches.push(`false positive: ${rule} at ${file}:${line} (${a - e})`);
    }
    if (e > a) {
      s.fn += e - a;
      mismatches.push(`false negative: ${rule} at ${file}:${line} (${e - a})`);
      const near = [...actual.keys()].some((k) => {
        const [r, f, l] = k.split('|');
        return r === rule && f === file && Math.abs(Number(l) - Number(line)) <= 2 && !expected.has(k);
      });
      if (near) locationMisses++;
    }
  }

  const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
  const rules = [...scores.entries()]
    .map(([ruleId, s]) => ({ ruleId, ...s, precision: ratio(s.tp, s.tp + s.fp), recall: ratio(s.tp, s.tp + s.fn) }))
    .sort((a, b) => compareText(a.ruleId, b.ruleId));
  const sum = rules.reduce((t, r) => ({ tp: t.tp + r.tp, fp: t.fp + r.fp, fn: t.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
  return {
    files: corpus.length,
    expected: [...expected.values()].reduce((a, b) => a + b, 0),
    reported: counted.length,
    rules,
    overall: { ...sum, precision: ratio(sum.tp, sum.tp + sum.fp), recall: ratio(sum.tp, sum.tp + sum.fn) },
    locationMisses,
    insufficientEvidenceRate: ratio(counted.filter((d) => d.verdict === 'insufficient-evidence').length, counted.length) ?? 0,
    durationMs,
    mismatches: mismatches.sort(),
  };
}

export function benchmarkMarkdown(r: BenchmarkResult): string {
  const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  return [
    `Corpus: ${r.files} files, ${r.expected} expected findings, ${r.reported} reported. Source engine time: ${r.durationMs} ms.`,
    '',
    '| Rule | TP | FP | FN | Precision | Recall |',
    '|---|---:|---:|---:|---:|---:|',
    ...r.rules.map((s) => `| \`${s.ruleId}\` | ${s.tp} | ${s.fp} | ${s.fn} | ${pct(s.precision)} | ${pct(s.recall)} |`),
    `| **All** | ${r.overall.tp} | ${r.overall.fp} | ${r.overall.fn} | ${pct(r.overall.precision)} | ${pct(r.overall.recall)} |`,
    '',
    `Location misses (right rule, line within 2 of the label): ${r.locationMisses}. Share of findings that are "insufficient evidence": ${pct(r.insufficientEvidenceRate)}.`,
    ...(r.mismatches.length ? ['', 'Mismatches:', ...r.mismatches.map((m) => `- ${m}`)] : []),
  ].join('\n');
}
