import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, makeProject, TEST_POLICY } from '../../packages/source-analysis/test/helpers.ts';

afterAll(cleanup);

// Runs with `pnpm test:pack`, not `pnpm test`: it builds, packs, and installs the tarballs and
// their dependencies from the npm registry (network, about a minute).
const root = path.resolve(import.meta.dirname, '../..');
const PACKAGES = ['core', 'source-analysis', 'visual-analysis', 'semantic-review', 'cli'];

/** Registry versions published after this are ignored, so transitive dependencies resolve as they did when tested. Move it forward with dependency updates. */
const BEFORE = '2026-10-11';

/** corepack and npm are .cmd shims on Windows, which only run through a shell: quote what it would split (a temp path with a space). */
const quote = (a: string) => (/^[\w./:=@-]+$/.test(a) ? a : `"${a}"`);
const run = (cmd: string, args: string[], cwd: string) =>
  process.platform === 'win32'
    ? execSync([cmd, ...args].map(quote).join(' '), { cwd, encoding: 'utf8', stdio: 'pipe' })
    : execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('npm packages', () => {
  it('build, pack and install into a fresh project, where design-warden runs from node_modules', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-pack-'));
    try {
      packAndInstall(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 600_000);
});

function packAndInstall(tmp: string) {
  const tarballs = path.join(tmp, 'tarballs');
  run('corepack', ['pnpm', 'run', 'build'], root);
  const deps: Record<string, string> = {};
  for (const p of PACKAGES) {
    run('corepack', ['pnpm', 'pack', '--pack-destination', tarballs], path.join(root, 'packages', p));
    const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'packages', p, 'package.json'), 'utf8')) as { name: string; version: string };
    deps[name] = `file:../tarballs/${name.slice(1).replace('/', '-')}-${version}.tgz`;
  }

  const app = path.join(tmp, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module', dependencies: deps }));
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', `--before=${BEFORE}`], app);

  const installed = path.join(app, 'node_modules', '@design-warden', 'cli');
  const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')) as { bin: Record<string, string>; dependencies: Record<string, string> };
  expect(manifest.dependencies['@design-warden/core']).toBe('0.1.0'); // workspace:* was replaced
  expect(fs.existsSync(path.join(installed, 'src'))).toBe(false); // only dist is published
  const bin = path.join(installed, manifest.bin['design-warden']!);

  const version = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  expect(version.stdout.trim()).toBe('0.1.0');

  const { root: project } = makeProject({ 'src/app/a.css': '.a { padding: 13px; }\n' });
  fs.writeFileSync(path.join(project, 'design-warden.policy.json'), JSON.stringify(TEST_POLICY));
  const check = spawnSync(process.execPath, [bin, 'check', '--policy', path.join(project, 'design-warden.policy.json'), '--format', 'json'], { encoding: 'utf8' });
  expect(check.stderr).toBe('');
  expect(check.status).toBe(1);
  expect(JSON.parse(check.stdout).findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(['spacing/scale']);
}
