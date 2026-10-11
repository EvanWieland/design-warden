import fs from 'node:fs';
import path from 'node:path';
import {
  dirChangeSet,
  exitCodeFor,
  finalizeFindings,
  gitChangeSet,
  loadPolicyFile,
  overallOutcome,
  parsePolicy,
  PolicyError,
  readFileAtCommit,
  resolveCommit,
  resolveInside,
  summarize,
  toPosix,
  type ChangeScope,
  type ChangeSet,
  type CheckDefinition,
  type EngineId,
  type EngineStatus,
  type FindingDraft,
  type LoadedPolicy,
  type ProvenanceRecord,
  type Report,
  type SemanticSummary,
  type VisualDiffSummary,
} from '@design-warden/core';
import { runSemanticReview, type SemanticProvider } from '@design-warden/semantic-review';
import { analyzeSource, SOURCE_CHECKS } from '@design-warden/source-analysis';
import { accessibilityCheck, accessibilityDrafts, compareCaptures, readCapturePair, visualDiffCheck, type AccessibilityOptions, type VisualDiffOptions } from '@design-warden/visual-analysis';
import { policyChangeNotes } from './policy-diff.ts';

export const ALL_CHECKS: readonly CheckDefinition[] = [...SOURCE_CHECKS, visualDiffCheck, accessibilityCheck];

/** The axe-core tags to capture with, when the policy has an accessibility rule (for `capture` and the harness). */
export function accessibilityCapture(loaded: LoadedPolicy): { tags: string[] } | undefined {
  const rule = loaded.policy.rules.find((r) => r.verify.by === 'check' && r.verify.check === accessibilityCheck.id);
  return rule ? (loaded.checkOptions.get(rule.id) as AccessibilityOptions) : undefined;
}
// Read at runtime, so the same code works from src/ and from the published dist/ (one level below package.json).
export const VERSION: string = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export class UsageError extends Error {
  override name = 'UsageError';
}

export interface ProgressEvent {
  engine: EngineId | 'run';
  status: 'started' | 'completed' | 'failed' | 'skipped' | 'incomplete';
  detail?: string;
  elapsedMs: number;
}

export interface AnalyzeOptions {
  policyPath: string;
  /** Load the policy (and guidance) from this git ref instead of the working tree. */
  policyRef?: string;
  /** Compare against this git ref (merge base) and scope findings to the change. */
  base?: string;
  /** Compare against an older copy of the project in this directory instead of a git ref. */
  baseDir?: string;
  scope?: ChangeScope;
  visual?: { baseDir: string; headDir: string; artifactDir: string };
  semantic?: { provider: SemanticProvider; dryRunFile?: string; timeoutMs?: number };
  /**
   * Report, and decide the outcome on, only this engine's findings. For CI jobs that split the work:
   * the blocking job runs the source check, and the visual and semantic jobs must not repeat or gate on it.
   * The source engine still runs, because the semantic review takes its findings as context.
   */
  only?: 'visual' | 'semantic';
  /** YYYY-MM-DD; defaults to today (UTC). Injected by tests for reproducibility. */
  today?: string;
  onProgress?: (e: ProgressEvent) => void;
}

/** Runs every configured engine and returns the report. Throws UsageError/PolicyError for invalid input. */
export async function analyze(opts: AnalyzeOptions): Promise<Report> {
  const started = Date.now();
  const progress = (engine: ProgressEvent['engine'], status: ProgressEvent['status'], detail?: string) =>
    opts.onProgress?.({ engine, status, detail, elapsedMs: Date.now() - started });
  progress('run', 'started');

  const loaded = await loadPolicy(opts);
  const { policy, root } = loaded;
  if (opts.base && opts.baseDir) throw new UsageError('--base and --base-dir cannot be combined');
  const scope: ChangeScope = opts.scope ?? (opts.base || opts.baseDir ? 'changed-lines' : 'all');
  const changes: ChangeSet | undefined = opts.base
    ? await gitChangeSet(root, opts.base)
    : opts.baseDir
      ? await dirChangeSet(root, opts.baseDir, policy.project.include, policy.project.exclude, [loaded.path, ...policy.tokens.sources])
      : undefined;
  const readBase = opts.base
    ? (file: string) => readFileAtCommit(root, changes!.base.sha, file)
    : opts.baseDir
      ? async (file: string) => (fs.existsSync(resolveInside(opts.baseDir!, file)) ? fs.readFileSync(resolveInside(opts.baseDir!, file), 'utf8') : null)
      : undefined;

  const drafts: FindingDraft[] = [];
  const engines: EngineStatus[] = [];
  const timed = async <T>(engine: EngineId, fn: () => Promise<T>): Promise<{ value?: T; ms: number; error?: string }> => {
    const t = Date.now();
    progress(engine, 'started');
    try {
      return { value: await fn(), ms: Date.now() - t };
    } catch (err) {
      return { error: (err as Error).message, ms: Date.now() - t };
    }
  };
  const record = (s: EngineStatus) => {
    engines.push(s);
    progress(s.engine, s.status, s.reason);
  };

  // The policy itself changing is always reported; a change must not be able to switch this off.
  if (changes) drafts.push(...(await policyChanged(loaded, changes, readBase!)));

  // ---- source (deterministic) ----
  let provenance: ProvenanceRecord[] = [];
  const source = await timed('source', () => analyzeSource({ loaded, changes, scope, readBase }));
  if (source.value) {
    drafts.push(...source.value.drafts);
    provenance = source.value.provenance;
    record({ engine: 'source', status: 'completed', durationMs: source.ms });
  } else {
    record({ engine: 'source', status: 'failed', reason: source.error, durationMs: source.ms });
  }
  const deterministic = [...drafts];

  // ---- visual ----
  let visual: Report['visual'];
  const visualRule = policy.rules.find((r) => r.verify.by === 'check' && r.verify.check === visualDiffCheck.id);
  const a11yRule = policy.rules.find((r) => r.verify.by === 'check' && r.verify.check === accessibilityCheck.id);
  if ((!visualRule && !a11yRule) || !policy.visual) {
    record({ engine: 'visual', status: 'skipped', reason: 'no rule uses the visual-diff or accessibility check' });
  } else if (!opts.visual) {
    record({ engine: 'visual', status: 'skipped', reason: 'no captures given (use --visual-base and --visual-head)' });
  } else {
    const v = opts.visual;
    const r = await timed('visual', async () => {
      const result = visualRule
        ? await compareCaptures({ ...v, ruleId: visualRule.id, options: loaded.checkOptions.get(visualRule.id) as VisualDiffOptions })
        : { drafts: [], diffs: [] };
      if (a11yRule) {
        const { base, head } = readCapturePair(v.baseDir, v.headDir);
        result.drafts.push(...accessibilityDrafts(base, head, a11yRule.id));
      }
      return result;
    });
    if (r.value) {
      drafts.push(...r.value.drafts);
      visual = { diffs: r.value.diffs, artifactDir: toPosix(path.relative(process.cwd(), v.artifactDir)) };
      record({ engine: 'visual', status: 'completed', durationMs: r.ms });
    } else {
      record({ engine: 'visual', status: 'failed', reason: r.error, durationMs: r.ms });
    }
  }

  // ---- semantic (optional, advisory) ----
  let semantic: SemanticSummary | undefined;
  if (!opts.semantic) {
    record({ engine: 'semantic', status: 'skipped', reason: 'not requested (use --semantic <provider>)' });
  } else {
    const guidance = await guidanceReader(loaded, opts.policyRef);
    const r = await timed('semantic', () =>
      runSemanticReview({
        loaded,
        provider: opts.semantic!.provider,
        changes,
        readFile: (p) => {
          try {
            return fs.readFileSync(resolveInside(root, p), 'utf8');
          } catch {
            return null;
          }
        },
        readGuidance: guidance,
        deterministic,
        provenance,
        screenshots: screenshotsFor(visual?.diffs, opts.visual?.artifactDir),
        timeoutMs: opts.semantic!.timeoutMs,
        dryRunFile: opts.semantic!.dryRunFile,
      }),
    );
    if (r.value) {
      drafts.push(...r.value.drafts);
      semantic = r.value.summary;
      record({ engine: 'semantic', status: r.value.status, reason: r.value.reason, durationMs: r.ms });
    } else {
      record({ engine: 'semantic', status: 'failed', reason: r.error, durationMs: r.ms });
    }
  }

  const all = finalizeFindings(drafts, { policy, changes, scope, today: opts.today ?? new Date().toISOString().slice(0, 10) });
  const findings = opts.only ? all.filter((f) => f.engine === opts.only) : all;
  const { outcome, reasons } = overallOutcome(findings, opts.only ? engines.filter((e) => e.engine === opts.only) : engines, policy.failurePolicy);
  const report: Report = {
    reportVersion: 1,
    tool: { name: 'design-warden', version: VERSION },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    policy: { name: policy.name, revision: policy.revision, path: loaded.path, sha256: loaded.sha256, source: loaded.source },
    target: {
      root: toPosix(path.relative(process.cwd(), root)) || '.',
      base: changes ? changes.base : null,
      scope,
      changedFiles: changes ? changes.files.map((f) => f.path) : [],
      ...(opts.only && { only: opts.only }),
    },
    outcome,
    outcomeReasons: reasons,
    exitCode: exitCodeFor(outcome),
    summary: summarize(findings),
    engines,
    findings,
    provenance,
    visual,
    semantic,
  };
  progress('run', 'completed', outcome);
  return report;
}

async function loadPolicy(opts: AnalyzeOptions): Promise<LoadedPolicy> {
  if (!opts.policyRef) return loadPolicyFile(opts.policyPath, ALL_CHECKS);
  const abs = path.resolve(opts.policyPath);
  const root = path.dirname(abs);
  const text = await readFileAtCommit(root, await resolveCommit(root, opts.policyRef), path.basename(abs));
  if (text === null) throw new PolicyError(`policy file ${path.basename(abs)} does not exist at ${opts.policyRef}`);
  return parsePolicy(text, { root, path: path.basename(abs), source: `git:${opts.policyRef}`, checks: ALL_CHECKS });
}

/** Guidance is read from the same trusted source as the policy, so a change cannot rewrite the reviewer's reference material. */
async function guidanceReader(loaded: LoadedPolicy, policyRef: string | undefined): Promise<(p: string) => string | null> {
  const cache = new Map<string, string | null>();
  const paths = Object.values(loaded.policy.guidance).flatMap((g) => (g.path ? [g.path] : []));
  const sha = policyRef ? await resolveCommit(loaded.root, policyRef) : null;
  for (const p of new Set(paths)) {
    try {
      cache.set(p, sha ? await readFileAtCommit(loaded.root, sha, p) : fs.readFileSync(resolveInside(loaded.root, p), 'utf8'));
    } catch {
      cache.set(p, null);
    }
  }
  return (p) => cache.get(p) ?? null;
}

async function policyChanged(loaded: LoadedPolicy, changes: ChangeSet, readBase: (f: string) => Promise<string | null>): Promise<FindingDraft[]> {
  const change = changes.files.find((f) => f.path === loaded.path);
  if (!change) return [];
  const head = fs.existsSync(path.join(loaded.root, loaded.path)) ? fs.readFileSync(path.join(loaded.root, loaded.path), 'utf8') : null;
  const notes = policyChangeNotes(await readBase(change.previousPath ?? loaded.path), head);
  return [
    {
      ruleId: 'policy/changed',
      verdict: 'violation',
      confidence: 'high',
      origin: 'deterministic',
      engine: 'policy',
      message: `The design policy changed in this change set${notes.length ? ` (${notes.length} rule-level change(s))` : ''}.`,
      location: { file: loaded.path, line: change.changedLines[0]?.start ?? 1 },
      evidence: notes.map((text) => ({ kind: 'note' as const, text })),
    },
  ];
}

function screenshotsFor(diffs: VisualDiffSummary[] | undefined, artifactDir: string | undefined): { name: string; path: string }[] {
  if (!diffs || !artifactDir) return [];
  return diffs.filter((d) => d.images.after).map((d) => ({ name: `${d.capture} (after)`, path: path.join(artifactDir, d.images.after!) }));
}
