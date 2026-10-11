import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyChanges, DEMO_DIR, loadScenario, WORK_DIR } from './scenarios.ts';

interface AppliedState {
  scenario: string;
  added: string[];
  modified: string[];
  /** Directories that apply created, deepest first. */
  createdDirs?: string[];
}

/** Apply state and backups live outside the target, one directory per target. */
const stateDir = (target: string) => path.join(WORK_DIR, 'applied', createHash('sha256').update(path.resolve(target)).digest('hex').slice(0, 12));
const stateFile = (target: string) => path.join(stateDir(target), 'state.json');
const backupDir = (target: string) => path.join(stateDir(target), 'backup');

/**
 * Copies a scenario's changes into a demo checkout (apps/demo by default) so the running app
 * shows them, keeping a backup. Only one scenario can be applied at a time; `resetDemo` restores it.
 */
export function applyScenario(id: string, target = DEMO_DIR): AppliedState {
  const current = appliedScenario(target);
  if (current) throw new Error(`scenario "${current}" is already applied; run "pnpm scenario reset" first`);
  const scenario = loadScenario(id);
  const state: AppliedState = { scenario: id, added: [], modified: [], createdDirs: [] };
  fs.mkdirSync(backupDir(target), { recursive: true });
  for (const rel of scenario.touchedFiles) {
    const dest = path.join(target, rel);
    if (fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(path.join(backupDir(target), rel)), { recursive: true });
      fs.copyFileSync(dest, path.join(backupDir(target), rel));
      state.modified.push(rel);
    } else {
      state.added.push(rel);
      for (let d = path.dirname(rel); d !== '.' && !fs.existsSync(path.join(target, d)); d = path.dirname(d)) {
        if (!state.createdDirs!.includes(d)) state.createdDirs!.push(d);
      }
    }
  }
  state.createdDirs!.sort((a, b) => b.length - a.length);
  // Write the state before touching the target so an interrupted apply can still be reset.
  fs.writeFileSync(stateFile(target), `${JSON.stringify(state, null, 2)}\n`);
  applyChanges(scenario, target);
  return state;
}

export function resetDemo(target = DEMO_DIR): AppliedState | null {
  if (!fs.existsSync(stateFile(target))) return null;
  const state = JSON.parse(fs.readFileSync(stateFile(target), 'utf8')) as AppliedState;
  for (const rel of state.modified) fs.copyFileSync(path.join(backupDir(target), rel), path.join(target, rel));
  for (const rel of state.added) fs.rmSync(path.join(target, rel), { force: true });
  for (const rel of state.createdDirs ?? []) {
    const dir = path.join(target, rel);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  fs.rmSync(stateDir(target), { recursive: true, force: true });
  return state;
}

export function appliedScenario(target = DEMO_DIR): string | null {
  return fs.existsSync(stateFile(target)) ? (JSON.parse(fs.readFileSync(stateFile(target), 'utf8')) as AppliedState).scenario : null;
}
