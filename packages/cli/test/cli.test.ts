import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../src/index.ts';
import { cleanup, commitAll, makeProject, TEST_POLICY, writeFiles } from '../../source-analysis/test/helpers.ts';

afterAll(cleanup);

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function project(files: Record<string, string> = {}, policy: object = TEST_POLICY) {
  const { root } = makeProject(files, policy);
  fs.writeFileSync(path.join(root, 'design-warden.policy.json'), JSON.stringify(policy, null, 2));
  return { root, policyPath: path.join(root, 'design-warden.policy.json') };
}

const CLEAN = { 'src/app/Page.tsx': "import { Button } from '../ds';\nexport const Page = () => <Button variant=\"primary\">Save</Button>;\n" };

describe('usage and policy errors (exit 2)', () => {
  it('prints help', async () => {
    const r = await cli('--help');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Usage:');
  });

  it.each([
    [['frobnicate'], /unknown command/],
    [['check', '--policy', 'does/not/exist.json'], /cannot read policy file/],
    [['check', '--format', 'xml'], /--format must be one of/],
    [['check', '--bogus'], /Unknown option/],
    [['check', '--base', '-h'], /ambiguous/], // -h as an option's value is not a request for help

  ])('%j exits 2', async (argv, message) => {
    const r = await cli(...argv);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(message);
  });

  it('rejects an invalid policy before running any check', async () => {
    const { policyPath } = project(CLEAN);
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, rules: [{ ...TEST_POLICY.rules[0], verify: { by: 'check', check: 'exec-shell' } }] }));
    const r = await cli('check', '--policy', policyPath);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unknown check "exec-shell"/);
  });

  it('rejects an unknown base ref with a hint about fetch depth', async () => {
    const { root, policyPath } = project(CLEAN);
    commitAll(root);
    const r = await cli('check', '--policy', policyPath, '--base', 'origin/nope');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/fetch-depth/);
  });
});

describe('outcomes and exit codes', () => {
  // Excalidraw trial: a full scan printed 4186 lines with no totals.
  it('totals a long list of findings by rule', async () => {
    const css = Array.from({ length: 11 }, (_, i) => `.c${i} { color: #12345${i % 10}; }`).join('\n');
    const r = await cli('check', '--policy', project({ ...CLEAN, 'src/app/many.css': `${css}\n.p { padding: 13px; }` }).policyPath);
    expect(r.out).toContain('By rule: color/no-literal 11 · spacing/scale 1');
  });

  it('passes compliant code (exit 0)', async () => {
    const r = await cli('check', '--policy', project(CLEAN).policyPath);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Result: PASS');
  });

  it('fails on a blocking violation with an actionable message (exit 1)', async () => {
    const r = await cli('check', '--policy', project({ 'src/app/a.css': '.a { color: #b91c1c; }' }).policyPath);
    expect(r.code).toBe(1);
    expect(r.out).toContain('color/no-literal');
    expect(r.out).toContain('Use var(--color-danger), which has exactly this value.');
  });

  it('requests review without failing, unless --fail-on review', async () => {
    const files = { 'src/app/Pill.tsx': 'export function StatusPill() { return <span>x</span>; }' };
    const { policyPath } = project(files);
    expect((await cli('check', '--policy', policyPath)).code).toBe(0);
    const strict = await cli('check', '--policy', policyPath, '--fail-on', 'review');
    expect(strict.code).toBe(1);
    expect(strict.out).toContain('Result: REVIEW');
  });

  it('writes a versioned JSON report', async () => {
    const { root, policyPath } = project({ 'src/app/a.css': '.a { padding: 13px; }' });
    const file = path.join(root, 'out', 'report.json');
    const r = await cli('check', '--policy', policyPath, '--format', 'json', '--report', file);
    const report = JSON.parse(r.out);
    expect(report).toMatchObject({ reportVersion: 1, outcome: 'fail', exitCode: 1, summary: { byOutcome: { fail: 1 } } });
    expect(report.findings[0]).toMatchObject({ ruleId: 'spacing/scale', location: { file: 'src/app/a.css', line: 1 }, origin: 'deterministic' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).outcome).toBe('fail');
  });
});

describe('github format', () => {
  it('emits escaped, capped annotations, a job summary and step outputs', async () => {
    const css = Array.from({ length: 12 }, (_, i) => `.c${i} { color: #${String(100000 + i)}; }`).join('\n');
    const { root, policyPath } = project({ 'src/app/a.css': `${css}\n`, 'src/app/b.css': '.x { padding: 3px; } /* 100%, done: yes */' });
    const summary = path.join(root, 'summary.md');
    const output = path.join(root, 'output.txt');
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
    vi.stubEnv('GITHUB_OUTPUT', output);
    vi.stubEnv('GITHUB_WORKSPACE', path.dirname(root));
    const r = await cli('check', '--policy', policyPath, '--format', 'github');
    vi.unstubAllEnvs();
    const errors = r.out.split('\n').filter((l) => l.startsWith('::error '));
    expect(errors).toHaveLength(10);
    expect(errors[0]).toMatch(new RegExp(`^::error file=${path.basename(root)}/src/app/a.css,line=1,col=\\d+,title=color/no-literal%3A color/no-literal::`));
    expect(r.out).toMatch(/::notice title=Design Warden::3 more finding\(s\) are not annotated/);
    expect(fs.readFileSync(summary, 'utf8')).toContain('## Design Warden: ❌ Fail');
    expect(fs.readFileSync(output, 'utf8')).toBe('outcome=fail\nexit-code=1\nblocking=13\nreview=0\n');
  });
});

describe('github output cannot be hijacked by repository text (security review 2026-10-10)', () => {
  it('keeps the human report inert and every line of untrusted text single-line', async () => {
    const evil = "export const A = ({ x }: { x: string }) => <p style={{ borderColor: x /*\n::stop-commands::abc\n::error file=evil.ts,line=1::pwned\n*/ }}>a</p>;\n";
    const { root, policyPath } = project({ 'src/app/A.tsx': evil, 'src/app/b.css': '.b { color: #123456; }' });
    const summary = path.join(root, 'summary.md');
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
    vi.stubEnv('GITHUB_WORKSPACE', root);
    const r = await cli('check', '--policy', policyPath, '--format', 'github');
    vi.unstubAllEnvs();
    const lines = r.out.split('\n');
    const token = /^::stop-commands::([0-9a-f]{32})$/.exec(lines[0]!)?.[1];
    expect(token).toBeDefined();
    const resume = lines.indexOf(`::${token}::`);
    expect(resume).toBeGreaterThan(0);
    // Outside the inert block, only our own annotations appear; nothing from the file starts a command.
    expect(lines.slice(resume + 1).every((l) => /^::(error|warning|notice) /.test(l))).toBe(true);
    expect(r.out).not.toMatch(/^::error file=evil/m);
    expect(lines.slice(1, resume).some((l) => l.startsWith('::'))).toBe(false);
  });

  it('escapes file names in the job summary', async () => {
    const { root, policyPath } = project({ 'src/app/a`![x](evil.example-p.png)`.css': '.a { color: #123456; }' });
    const summary = path.join(root, 'summary.md');
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
    await cli('check', '--policy', policyPath, '--format', 'github');
    vi.unstubAllEnvs();
    const text = fs.readFileSync(summary, 'utf8');
    expect(text).not.toContain('![x](');
    expect(text).toContain('\\!\\[x\\]\\(');
  });
});

describe('change-aware checks', () => {
  function repoWithChange(change: Record<string, string>) {
    const p = project(CLEAN);
    commitAll(p.root);
    writeFiles(p.root, change);
    return p;
  }

  it('a model "violation" requests review but never fails the build', async () => {
    const { root, policyPath } = repoWithChange({ 'src/app/New.tsx': "import { Button } from '../ds';\nexport const New = () => <Button>Go</Button>;\n" });
    const policy = { ...TEST_POLICY, rules: [...TEST_POLICY.rules, { id: 'layout/one-primary', version: 1, title: 'One primary', category: 'preferred', description: 'd', rationale: 'r', verify: { by: 'semantic' }, remediation: 'x' }], semanticReview: { enabled: true } };
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    const replay = path.join(root, 'replay.json');
    fs.writeFileSync(replay, JSON.stringify({ findings: [{ ruleId: 'layout/one-primary', verdict: 'violation', confidence: 'high', file: 'src/app/New.tsx', line: 2, quote: '<Button>Go</Button>', explanation: 'x', guidance: [], remediation: 'y' }] }));
    const r = await cli('check', '--policy', policyPath, '--base', 'main', '--semantic', 'replay', '--semantic-replay', replay, '--format', 'json');
    const report = JSON.parse(r.out);
    const ai = report.findings.find((f: { origin: string }) => f.origin === 'ai');
    expect(ai).toMatchObject({ verdict: 'violation', outcome: 'review', engine: 'semantic' });
    expect(report.semantic).toMatchObject({ provider: 'replay', accepted: 1, dataSent: { files: ['src/app/New.tsx'] } });
    expect(r.code).toBe(0);
  });

  it('--only semantic reports and gates on the model review alone (the split CI job)', async () => {
    const { root, policyPath } = repoWithChange({
      'src/app/a.css': '.a { color: #b91c1c; }\n',
      'src/app/New.tsx': "import { Button } from '../ds';\nexport const New = () => <Button>Go</Button>;\n",
    });
    const policy = { ...TEST_POLICY, rules: [...TEST_POLICY.rules, { id: 'layout/one-primary', version: 1, title: 'One primary', category: 'preferred', description: 'd', rationale: 'r', verify: { by: 'semantic' }, remediation: 'x' }], semanticReview: { enabled: true } };
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    const replay = path.join(root, 'replay.json');
    fs.writeFileSync(replay, JSON.stringify({ findings: [{ ruleId: 'layout/one-primary', verdict: 'violation', confidence: 'high', file: 'src/app/New.tsx', line: 2, quote: '<Button>Go</Button>', explanation: 'x', guidance: [], remediation: 'y' }] }));
    const args = ['check', '--policy', policyPath, '--base', 'main', '--semantic', 'replay', '--semantic-replay', replay, '--format', 'json'];
    expect((await cli(...args)).code).toBe(1); // the deterministic violation blocks...

    const r = await cli(...args, '--only', 'semantic');
    const report = JSON.parse(r.out);
    expect(report.findings.map((f: { engine: string }) => f.engine)).toEqual(['semantic']);
    expect(report.target.only).toBe('semantic');
    expect(report.outcome).toBe('review');
    expect(r.code).toBe(0); // ...but the review-only job neither repeats nor gates on it

    expect((await cli('check', '--policy', policyPath, '--only', 'visual')).code).toBe(2);
    expect((await cli('check', '--policy', policyPath, '--only', 'source')).code).toBe(2);
  });

  it('keeps deterministic results and requests review when the model provider is unreachable', async () => {
    const { policyPath } = repoWithChange({ 'src/app/a.css': '.a { color: #b91c1c; }\n' });
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, semanticReview: { enabled: true } }));
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://127.0.0.1:9');
    const r = await cli('check', '--policy', policyPath, '--base', 'main', '--semantic', 'anthropic', '--semantic-timeout', '20', '--format', 'json');
    vi.unstubAllEnvs();
    const report = JSON.parse(r.out);
    expect(report.engines.find((e: { engine: string }) => e.engine === 'semantic')).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^network/) });
    expect(report.findings.some((f: { ruleId: string }) => f.ruleId === 'color/no-literal')).toBe(true);
    expect(report.outcome).toBe('fail'); // the deterministic failure still decides
  });

  it('loads the policy from the base branch so a change cannot weaken its own checks', async () => {
    const { root, policyPath } = project(CLEAN);
    commitAll(root);
    const weakened = { ...TEST_POLICY, rules: TEST_POLICY.rules.map((r) => (r.id === 'color/no-literal' ? { ...r, enforcement: 'report' } : r)) };
    writeFiles(root, { 'design-warden.policy.json': JSON.stringify(weakened, null, 2), 'src/app/a.css': '.a { color: #b91c1c; }\n' });

    const trusting = await cli('check', '--policy', policyPath, '--base', 'main', '--format', 'json');
    expect(JSON.parse(trusting.out).outcome).toBe('review'); // the weakened rule only reports; the policy change requests review

    const r = await cli('check', '--policy', policyPath, '--base', 'main', '--policy-ref', 'main', '--format', 'json');
    const report = JSON.parse(r.out);
    expect(report.policy.source).toBe('git:main');
    expect(report.outcome).toBe('fail');
    const changed = report.findings.find((f: { ruleId: string }) => f.ruleId === 'policy/changed');
    expect(changed.evidence.map((e: { text: string }) => e.text)).toContain('Rule color/no-literal: enforcement block -> report (weakened).');
  });
});

describe('policy commands', () => {
  it('validates and tests rule examples', async () => {
    const policy = {
      ...TEST_POLICY,
      rules: TEST_POLICY.rules.map((r) =>
        r.id === 'color/no-literal'
          ? { ...r, examples: [{ file: 'src/app/x.css', code: '.a { color: red; }', expect: 'fail' }, { file: 'src/app/y.css', code: '.a { color: var(--color-text); }', expect: 'pass' }, { file: 'src/app/z.css', code: '.a { color: var(--color-text); }', expect: 'fail' }] }
          : r,
      ),
    };
    const { policyPath } = project(CLEAN, policy);
    expect((await cli('policy', 'validate', '--policy', policyPath)).out).toMatch(/^Policy valid: Test \(rev 1\) - 10 rules/);
    const t = await cli('policy', 'test', '--policy', policyPath);
    expect(t.code).toBe(1);
    expect(t.out).toContain('2/3 examples behave as declared');
    expect(t.out).toMatch(/FAIL color\/no-literal \[expect fail\] src\/app\/z\.css/);
  });

  // shadcn/ui trial: the token file's own `!important` made a passing example fail.
  it('judges an example by its own findings, not by findings in the token sources', async () => {
    const tokens = ':root { --color-text: #0f172a !important; }';
    const policy = {
      ...TEST_POLICY,
      rules: TEST_POLICY.rules.map((r) => (r.id === 'styles/no-important' ? { ...r, scope: {}, examples: [{ file: 'src/app/ok.css', code: '.a { color: var(--color-text); }', expect: 'pass' }] } : r)),
    };
    const { policyPath } = project({ ...CLEAN, 'src/ds/tokens.css': tokens }, policy);
    const t = await cli('policy', 'test', '--policy', policyPath);
    expect(t.out).toContain('1/1 examples behave as declared');
    expect(t.code).toBe(0);
  });

  it('prints help after a command too', async () => {
    const r = await cli('check', '--help');
    expect(r.code).toBe(0);
    expect(r.out).toContain('check options:');
  });

  it('prints the JSON schema', async () => {
    const r = await cli('policy', 'schema');
    expect(JSON.parse(r.out)).toMatchObject({ type: 'object', required: expect.arrayContaining(['policyVersion', 'rules']) });
  });
});
