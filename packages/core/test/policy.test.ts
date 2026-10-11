import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parsePolicy, policyJsonSchema, PolicyError, type CheckDefinition } from '../src/index.ts';

const checks: CheckDefinition[] = [
  { id: 'no-hardcoded-color', engine: 'source', description: 'test', options: z.strictObject({ allow: z.array(z.string()).default([]) }) },
];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function project(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-policy-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries({ 'tokens.css': ':root { --color-text: #111; }', 'guide.md': '# Colors', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

export const minimalPolicy = () => ({
  policyVersion: 1,
  name: 'Test policy',
  revision: '1',
  project: { include: ['src/**/*.tsx'] },
  designSystem: { paths: ['src/ds/**'], importSources: ['src/ds'] },
  tokens: { sources: ['tokens.css'], allowedPrefixes: ['--color-'] },
  guidance: { colors: { title: 'Colors', path: 'guide.md' } },
  rules: [
    {
      id: 'color/tokens-only',
      version: 1,
      title: 'Use color tokens',
      category: 'mandatory',
      description: 'Colors come from tokens.',
      rationale: 'Consistency.',
      verify: { by: 'check', check: 'no-hardcoded-color' },
      guidance: ['colors'],
      remediation: 'Use a token.',
    },
  ],
});

const load = (policy: unknown, root = project()) =>
  parsePolicy(JSON.stringify(policy), { root, path: 'policy.json', source: 'working-tree', checks });

function issuesOf(policy: unknown, root?: string): string[] {
  try {
    load(policy, root);
  } catch (err) {
    if (err instanceof PolicyError) return err.issues.length ? err.issues : [err.message];
    throw err;
  }
  throw new Error('expected the policy to be rejected');
}

describe('parsePolicy', () => {
  it('accepts a minimal valid policy and applies check option defaults', () => {
    const loaded = load(minimalPolicy());
    expect(loaded.policy.rules[0]?.id).toBe('color/tokens-only');
    expect(loaded.checkOptions.get('color/tokens-only')).toEqual({ allow: [] });
    expect(loaded.policy.failurePolicy.source).toBe('fail-closed');
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects malformed JSON with a clear message', () => {
    expect(() => parsePolicy('{ nope', { root: project(), path: 'p.json', source: 'x', checks })).toThrow(/not valid JSON/);
  });

  it('rejects unknown fields instead of ignoring them', () => {
    expect(issuesOf({ ...minimalPolicy(), surprise: true }).join()).toMatch(/surprise|Unrecognized/i);
  });

  it('rejects unknown checks and invalid check options', () => {
    const p = minimalPolicy();
    p.rules[0]!.verify = { by: 'check', check: 'run-shell' };
    expect(issuesOf(p).join()).toMatch(/unknown check "run-shell"/);
    const q = minimalPolicy();
    q.rules[0]!.verify = { by: 'check', check: 'no-hardcoded-color', options: { allow: 'red' } } as never;
    expect(issuesOf(q).join()).toMatch(/verify\.options\.allow/);
  });

  it('refuses semantic rules that would block a merge', () => {
    const p = minimalPolicy();
    p.rules[0]!.verify = { by: 'semantic' } as never;
    expect(issuesOf(p).join()).toMatch(/cannot use enforcement "block"/);
  });

  it('rejects unknown guidance keys, duplicate ids and exceptions for unknown rules', () => {
    const p = { ...minimalPolicy(), exceptions: [{ id: 'x', rules: ['nope'], paths: ['src/**'], reason: 'because legacy' }] };
    p.rules.push({ ...p.rules[0]!, guidance: ['missing'] });
    const issues = issuesOf(p).join('\n');
    expect(issues).toMatch(/duplicate rule id/);
    expect(issues).toMatch(/unknown guidance "missing"/);
    expect(issues).toMatch(/unknown rule "nope"/);
  });

  it('rejects referenced files that are missing or outside the project root', () => {
    const p = minimalPolicy();
    p.tokens.sources = ['missing.css', '../outside.css', 'C:/Windows/win.ini'];
    const issues = issuesOf(p).join('\n');
    expect(issues).toMatch(/file not found: missing\.css/);
    expect(issues).toMatch(/escapes the project root/);
    expect(issues).toMatch(/absolute paths are not allowed/);
  });

  it('the committed JSON Schema (used for editor completion) matches the zod schema', () => {
    const committed = JSON.parse(fs.readFileSync(new URL('../schema/policy.schema.json', import.meta.url), 'utf8'));
    expect(committed).toEqual(policyJsonSchema()); // regenerate with: pnpm schema
  });

  it('rejects an unsupported policy version', () => {
    expect(issuesOf({ ...minimalPolicy(), policyVersion: 2 }).join()).toMatch(/policyVersion/);
  });
});
