import { createHash, randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { analyze, type ProgressEvent } from 'design-warden';
import type { Report } from '@design-warden/core';
import { anthropicProvider, replayProvider, type SemanticProvider } from '@design-warden/semantic-review';
import { appliedScenario } from './apply.ts';
import { applyChanges, checkExpectations, DEMO_DIR, loadScenario, POLICY_FILE, WORK_DIR, type Scenario } from './scenarios.ts';

const exec = promisify(execFile);

export type SemanticMode = 'off' | 'replay' | 'anthropic';

export interface RunOptions {
  visual?: boolean;
  /** A mode, or a provider used as it is (a local model for `pnpm eval:semantic`). */
  semantic?: SemanticMode | SemanticProvider;
  onProgress?: (e: ProgressEvent | { engine: 'harness'; status: 'started' | 'completed'; detail?: string; elapsedMs: number }) => void;
}

export interface ScenarioRun {
  scenario: Scenario;
  runDir: string;
  report: Report;
  mismatches: string[];
}

const COPY_EXCLUDE = new Set(['node_modules', 'dist', '.design-warden']);

/**
 * Runs one scenario the way CI would: the clean demo is committed as "main" in a fresh
 * git repository, the scenario's overlay is applied on top, and `analyze --base main` runs.
 * Nothing in apps/demo is modified.
 */
export async function runScenario(id: string, opts: RunOptions = {}): Promise<ScenarioRun> {
  const scenario = loadScenario(id);
  const applied = appliedScenario();
  if (applied) throw new Error(`scenario "${applied}" is applied to apps/demo, so it is not clean; run "pnpm scenario reset" first`);
  const started = Date.now();
  const step = (detail: string, status: 'started' | 'completed' = 'started') =>
    opts.onProgress?.({ engine: 'harness', status, detail, elapsedMs: Date.now() - started });

  // Unique per run, so parallel runs of the same scenario never share files.
  const runDir = path.join(WORK_DIR, 'runs', id, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`);
  const workspace = path.join(runDir, 'workspace');
  fs.mkdirSync(runDir, { recursive: true });

  step('preparing an isolated git workspace from apps/demo');
  fs.cpSync(DEMO_DIR, workspace, { recursive: true, filter: (src) => !COPY_EXCLUDE.has(path.basename(src)) });
  git(workspace, 'init', '-q', '-b', 'main');
  // The dependency link added for visual builds must not show up as changed files. No trailing slash:
  // off Windows the link is a symlink, which git treats as a file, and `node_modules/` matches only directories.
  fs.appendFileSync(path.join(workspace, '.git', 'info', 'exclude'), '\nnode_modules\n');
  git(workspace, 'add', '-A');
  git(workspace, 'commit', '-q', '-m', 'base: clean demo');

  let visual: { baseDir: string; headDir: string; artifactDir: string } | undefined;
  if (opts.visual) {
    step('building and capturing the base revision');
    const baseDir = await baseCaptures(workspace);
    applyChanges(scenario, workspace);
    step('building and capturing the head revision');
    const headDir = path.join(runDir, 'captures', 'head');
    await buildAndCapture(workspace, path.join(runDir, 'dist-head'), headDir);
    visual = { baseDir, headDir, artifactDir: path.join(runDir, 'artifacts') };
  } else {
    applyChanges(scenario, workspace);
  }
  step('workspace ready', 'completed');

  const report = await analyze({
    policyPath: path.join(workspace, POLICY_FILE),
    base: 'main',
    policyRef: scenario.policyFromBase ? 'main' : undefined,
    visual,
    semantic: typeof opts.semantic === 'object' ? { provider: opts.semantic, timeoutMs: 600_000 } : semanticFor(scenario, opts.semantic ?? 'off'),
    today: '2026-10-10',
    onProgress: opts.onProgress,
  });
  fs.writeFileSync(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { scenario, runDir, report, mismatches: checkExpectations(report, scenario) };
}

function semanticFor(scenario: Scenario, mode: SemanticMode): { provider: SemanticProvider; timeoutMs: number } | undefined {
  if (mode === 'off') return undefined;
  if (mode === 'anthropic') return { provider: anthropicProvider(), timeoutMs: 180_000 };
  // Scenarios without a recording get an empty one: the review "completes" with no findings.
  const file = scenario.replayFile ?? path.join(WORK_DIR, 'empty-replay.json');
  if (!scenario.replayFile) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    fs.writeFileSync(file, '{"findings":[]}');
  }
  return { provider: replayProvider(file), timeoutMs: 10_000 };
}


function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', '-c', 'user.name=design-warden', '-c', 'user.email=harness@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

/** Base captures depend only on the clean demo, so they are cached by a hash of its files. */
async function baseCaptures(workspace: string): Promise<string> {
  // Bump when the capture format or capture preset changes, so stale caches are never reused.
  const hash = createHash('sha256').update('capture-format-2');
  for (const f of fs.globSync('**/*', { cwd: workspace, exclude: (p) => p.includes('.git') }).sort()) {
    const abs = path.join(workspace, f);
    if (fs.statSync(abs).isFile()) hash.update(f).update(fs.readFileSync(abs));
  }
  const dir = path.join(WORK_DIR, 'cache', `base-${hash.digest('hex').slice(0, 16)}`);
  if (!fs.existsSync(path.join(dir, 'captures', 'manifest.json'))) {
    // Build into a private directory and rename, so concurrent runs never read a half-written cache.
    const tmp = `${dir}.tmp-${randomBytes(3).toString('hex')}`;
    await buildAndCapture(workspace, path.join(tmp, 'dist'), path.join(tmp, 'captures'));
    try {
      fs.renameSync(tmp, dir);
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true }); // another run finished first
    }
  }
  return path.join(dir, 'captures');
}

async function buildAndCapture(workspace: string, outDir: string, captureDir: string): Promise<void> {
  // The workspace reuses the demo's installed dependencies through a junction (no admin rights needed on Windows).
  const modules = path.join(workspace, 'node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(path.join(DEMO_DIR, 'node_modules'), modules, 'junction');
  const vite = path.join(DEMO_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  await exec(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: workspace, windowsHide: true });
  const { captureAll, serveStatic } = await import('@design-warden/visual-analysis/capture');
  const { loadPolicyFile } = await import('@design-warden/core');
  const { ALL_CHECKS, accessibilityCapture } = await import('design-warden');
  const loaded = loadPolicyFile(path.join(workspace, POLICY_FILE), ALL_CHECKS);
  const server = await serveStatic(outDir);
  try {
    await captureAll({ baseUrl: server.url, visual: loaded.policy.visual!, outDir: captureDir, accessibility: accessibilityCapture(loaded) });
  } finally {
    await server.close();
  }
}
