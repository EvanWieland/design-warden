import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePolicy, type LoadedPolicy } from '@design-warden/core';
import { SOURCE_CHECKS } from '../src/index.ts';

export const TOKENS = `:root {
  --palette-blue: #2563eb;
  --color-action: var(--palette-blue);
  --color-text: #0f172a;
  --color-danger: #b91c1c;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --font-size-md: 14px;
  --font-size-lg: 16px;
}`;

export const DS_FILES: Record<string, string> = {
  'src/ds/tokens.css': TOKENS,
  'src/ds/Button.tsx': `export function Button(props: { variant?: string; children?: unknown }) { return <button className="ds-button">{props.children as never}</button>; }`,
  'src/ds/Badge.tsx': `export function Badge(props: { tone: string; children?: unknown }) { return <span className="ds-badge">{props.children as never}</span>; }`,
  'src/ds/DataTable.tsx': `export function DataTable(props: { rows: unknown[] }) { return <table><tbody /></table>; }`,
  'src/ds/Card.tsx': `export function Card(props: { children?: unknown }) { return <section className="ds-card">{props.children as never}</section>; }`,
  'src/ds/index.ts': `export * from './Button';\nexport * from './Badge';\nexport * from './DataTable';\nexport * from './Card';`,
  'guide.md': '# Guide\n## Color\nUse tokens.',
};

const rule = (id: string, check: string, category = 'mandatory', extra: object = {}) => ({
  id,
  version: 1,
  title: id,
  category,
  description: 'd',
  rationale: 'r',
  verify: { by: 'check', check },
  remediation: 'fix it',
  ...extra,
});

export const TEST_POLICY = {
  policyVersion: 1,
  name: 'Test',
  revision: '1',
  project: { include: ['src/**/*.{ts,tsx,css,scss,vue,svelte}'] },
  designSystem: { paths: ['src/ds/**'], importSources: ['src/ds'] },
  tokens: { sources: ['src/ds/tokens.css'], allowedPrefixes: ['--color-', '--space-', '--font-size-'] },
  guidance: { color: { title: 'Color', path: 'guide.md', section: 'Color' } },
  components: [
    { name: 'Button', source: 'src/ds/Button.tsx', replaces: ['button', '[role=button]'], aliases: ['btn'], props: { variant: { allowed: ['primary', 'secondary'] } } },
    { name: 'Badge', source: 'src/ds/Badge.tsx', aliases: ['pill', 'status label'], props: { tone: { required: true, allowed: ['info', 'danger'] } } },
    { name: 'DataTable', source: 'src/ds/DataTable.tsx', replaces: ['table'], props: { status: { required: true }, emptyState: { required: true } } },
    { name: 'Card', source: 'src/ds/Card.tsx' },
  ],
  patterns: [] as object[],
  rules: [
    rule('color/no-literal', 'no-hardcoded-color', 'mandatory', { guidance: ['color'] }),
    rule('spacing/scale', 'spacing-scale'),
    rule('typography/scale', 'spacing-scale', 'mandatory', { verify: { by: 'check', check: 'spacing-scale', options: { properties: ['font-size'], tokenPrefix: '--font-size-', units: ['px', 'rem'] } } }),
    rule('tokens/semantic', 'token-usage'),
    rule('styles/no-important', 'no-important', 'mandatory', { scope: { exclude: ['src/ds/**'] } }),
    rule('components/raw', 'raw-element', 'required-pattern', { scope: { exclude: ['src/ds/**'] } }),
    rule('components/props', 'component-props', 'required-pattern'),
    rule('components/reuse', 'duplicate-component', 'preferred'),
    rule('patterns/provenance', 'pattern-provenance', 'preferred', { scope: { exclude: ['src/ds/**'] } }),
    rule('governance/shared', 'shared-change', 'mandatory', { enforcement: 'review', scope: { include: ['src/ds/**'] } }),
  ],
};

const roots: string[] = [];
export function cleanup() {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
}

/** Writes a temporary project and loads its policy with the real source checks. */
export function makeProject(files: Record<string, string>, policy: object = TEST_POLICY): { root: string; loaded: LoadedPolicy } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-src-'));
  roots.push(root);
  writeFiles(root, { ...DS_FILES, ...files });
  const loaded = parsePolicy(JSON.stringify(policy), { root, path: 'design-warden.policy.json', source: 'test', checks: SOURCE_CHECKS });
  return { root, loaded };
}

export function writeFiles(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

export function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
}

/** Turns the project into a git repo with everything committed on branch "main". */
export function commitAll(root: string, message = 'base') {
  if (!fs.existsSync(path.join(root, '.git'))) git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}
