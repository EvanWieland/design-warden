import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInside, type Report } from '@design-warden/core';
import { z } from 'zod';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEMO_DIR = path.join(REPO_ROOT, 'apps', 'demo');
export const SCENARIOS_DIR = path.join(REPO_ROOT, 'fixtures', 'scenarios');
export const WORK_DIR = path.join(REPO_ROOT, '.design-warden');
export const POLICY_FILE = 'design-warden.policy.json';

const expectedFinding = z.strictObject({
  ruleId: z.string(),
  file: z.string().optional(),
  line: z.int().optional(),
  outcome: z.enum(['fail', 'review', 'info']).optional(),
  messageIncludes: z.string().optional(),
});

const editsSchema = z.array(z.strictObject({ file: z.string(), find: z.string().min(1), replace: z.string() }));
export type Edit = z.infer<typeof editsSchema>[number];

const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  number: z.int(),
  title: z.string(),
  kind: z.enum(['clean', 'violation', 'review', 'legitimate-deviation', 'security']),
  summary: z.string(),
  whyItMatters: z.string(),
  /** Load the policy from the base commit (as CI should with --policy-ref). */
  policyFromBase: z.boolean().default(false),
  expected: z.strictObject({
    outcome: z.enum(['pass', 'review', 'fail', 'error']),
    findings: z.array(expectedFinding).default([]),
    /** Rules that must not produce active findings (false-positive guards). */
    absentRules: z.array(z.string()).default([]),
    provenance: z.array(z.strictObject({ component: z.string(), classification: z.enum(['established', 'modified', 'novel', 'insufficient-evidence']) })).default([]),
    /** Labels for the opt-in semantic evaluation (pnpm eval:semantic). Written by hand, never by a model. */
    semantic: z
      .strictObject({
        mustInclude: z.array(z.strictObject({ ruleId: z.string(), verdicts: z.array(z.string()).min(1) })).default([]),
        noViolations: z.boolean().default(false),
      })
      .optional(),
    note: z.string().optional(),
  }),
});

export type Scenario = z.infer<typeof scenarioSchema> & {
  dir: string;
  /** Files copied from overlay/ (added or replaced). */
  overlayFiles: string[];
  /** Exact find/replace edits to existing demo files, from edits.json: small, realistic diffs. */
  edits: Edit[];
  /** Every demo file the scenario adds or changes. */
  touchedFiles: string[];
  replayFile?: string;
};

export function listScenarios(): Scenario[] {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  return fs
    .readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadScenario(d.name))
    .sort((a, b) => a.number - b.number);
}

export function loadScenario(id: string): Scenario {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`invalid scenario id "${id}"`);
  const dir = path.join(SCENARIOS_DIR, id);
  const file = path.join(dir, 'scenario.json');
  if (!fs.existsSync(file)) throw new Error(`unknown scenario "${id}"`);
  const parsed = scenarioSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const overlay = path.join(dir, 'overlay');
  const overlayFiles = fs.existsSync(overlay)
    ? fs.globSync('**/*', { cwd: overlay }).filter((f) => fs.statSync(path.join(overlay, f)).isFile()).map((f) => f.split(path.sep).join('/'))
    : [];
  const editsFile = path.join(dir, 'edits.json');
  const edits = fs.existsSync(editsFile) ? editsSchema.parse(JSON.parse(fs.readFileSync(editsFile, 'utf8'))) : [];
  const replay = path.join(dir, 'semantic-replay.json');
  return {
    ...parsed.data,
    dir,
    overlayFiles,
    edits,
    touchedFiles: [...new Set([...overlayFiles, ...edits.map((e) => e.file)])],
    replayFile: fs.existsSync(replay) ? replay : undefined,
  };
}

/** Applies a scenario to a copy of the demo (or the demo itself): overlay files first, then edits. */
export function applyChanges(scenario: Scenario, target: string): void {
  for (const rel of scenario.overlayFiles) {
    const dest = resolveInside(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(scenario.dir, 'overlay', rel), dest);
  }
  for (const e of scenario.edits) {
    const file = resolveInside(target, e.file);
    const text = fs.readFileSync(file, 'utf8');
    const count = text.split(e.find).length - 1;
    if (count !== 1) throw new Error(`scenario ${scenario.id}: edit to ${e.file} expected exactly one match, found ${count}. Has the demo changed?`);
    fs.writeFileSync(file, text.replace(e.find, () => e.replace));
  }
}

/**
 * Compares a report with a scenario's expectations. Strict about deterministic results:
 * any active source or policy finding not listed in the expectations is reported as a mismatch,
 * which is how false positives show up. Model and visual findings are not part of the contract.
 */
export function checkExpectations(report: Report, scenario: Scenario): string[] {
  const problems: string[] = [];
  const e = scenario.expected;
  if (report.outcome !== e.outcome) problems.push(`outcome: expected ${e.outcome}, got ${report.outcome}`);
  const active = report.findings.filter((f) => !f.suppressed && !f.preexisting && (f.engine === 'source' || f.engine === 'policy'));
  const matched = new Set<string>();
  for (const x of e.findings) {
    const hit = active.find(
      (f) =>
        !matched.has(f.id) &&
        f.ruleId === x.ruleId &&
        (x.file === undefined || f.location?.file === x.file) &&
        (x.line === undefined || f.location?.line === x.line) &&
        (x.outcome === undefined || f.outcome === x.outcome) &&
        (x.messageIncludes === undefined || f.message.includes(x.messageIncludes)),
    );
    if (hit) matched.add(hit.id);
    else problems.push(`missing finding: ${JSON.stringify(x)}`);
  }
  for (const f of active) {
    if (!matched.has(f.id)) problems.push(`unexpected finding: ${f.ruleId} at ${f.location ? `${f.location.file}:${f.location.line}` : 'project'} (${f.message})`);
  }
  for (const r of e.absentRules) if (active.some((f) => f.ruleId === r)) problems.push(`rule ${r} should not report`);
  for (const p of e.provenance) {
    const rec = report.provenance.find((r) => r.component === p.component);
    if (rec?.classification !== p.classification) problems.push(`provenance of ${p.component}: expected ${p.classification}, got ${rec?.classification ?? 'none'}`);
  }
  return problems;
}
