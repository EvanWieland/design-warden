import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/index.ts';
import { policyChangeNotes } from '../src/policy-diff.ts';
import { renderGitlab } from '../src/reporters/gitlab.ts';
import { renderSarif } from '../src/reporters/sarif.ts';
import { cleanup, commitAll, makeProject, TEST_POLICY, writeFiles } from '../../source-analysis/test/helpers.ts';

afterAll(cleanup);

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: string;
  locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[];
  partialFingerprints: Record<string, string>;
}

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function project(files: Record<string, string>, policy: object = TEST_POLICY) {
  const { root } = makeProject(files, policy);
  const policyPath = path.join(root, 'design-warden.policy.json');
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  return { root, policyPath };
}

describe('policy exceptions', () => {
  const policy = {
    ...TEST_POLICY,
    exceptions: [{ id: 'partner', rules: ['color/no-literal'], paths: ['src/legacy/**'], reason: 'partner brand colours by contract', expires: '2026-06-30' }],
  };
  const files = { 'src/legacy/promo.css': '.p { color: #ff6a00; }', 'src/app/a.css': '.a { color: #123456; }' };

  it('suppresses only the named rule on the named paths while active', async () => {
    const r = JSON.parse((await cli('check', '--policy', project(files, policy).policyPath, '--today', '2026-06-01', '--format', 'json')).out);
    const colors = r.findings.filter((f: { ruleId: string }) => f.ruleId === 'color/no-literal');
    expect(colors.map((f: { location: { file: string }; suppressed?: { exceptionId: string } }) => [f.location.file, f.suppressed?.exceptionId])).toEqual([
      ['src/app/a.css', undefined],
      ['src/legacy/promo.css', 'partner'],
    ]);
  });

  it('stops applying after expiry and asks for review', async () => {
    const r = JSON.parse((await cli('check', '--policy', project(files, policy).policyPath, '--today', '2026-07-01', '--format', 'json')).out);
    expect(r.findings.filter((f: { suppressed?: unknown }) => f.suppressed)).toEqual([]);
    expect(r.findings.find((f: { ruleId: string }) => f.ruleId === 'policy/exception-expired')).toMatchObject({ outcome: 'review', message: expect.stringContaining('expired on 2026-06-30') });
  });
});

describe('approvals (ADR 0012)', () => {
  // A review request (a computed inline padding: insufficient evidence) and a blocking finding (13px).
  const files = { 'src/app/A.tsx': 'export const A = ({ g }: { g: number }) => <div style={{ padding: g }} />;\n', 'src/app/b.css': '.b { padding: 13px; }\n' };
  type F = { id: string; ruleId: string; outcome: string; location: { file: string }; suppressed?: object };
  const approve = (f: F, expires = '2099-01-01') => ({ fingerprint: f.id, rule: f.ruleId, file: f.location.file, reason: 'Accepted in design review', approvedBy: 'design-system team', expires });
  const findings = async (...argv: string[]): Promise<F[]> => JSON.parse((await cli('check', ...argv, '--format', 'json', '--today', '2026-10-10')).out).findings;

  it('clear an accepted review request but never a blocking finding, and only from the trusted policy', async () => {
    const { root, policyPath } = project(files);
    const before = await findings('--policy', policyPath);
    const review = before.find((f) => f.outcome === 'review')!;
    const blocking = before.find((f) => f.outcome === 'fail')!;
    const approved = JSON.stringify({ ...TEST_POLICY, approvals: [approve(review), approve(blocking)] });

    fs.writeFileSync(policyPath, approved);
    const local = await findings('--policy', policyPath);
    expect(local.find((f) => f.id === review.id)).toMatchObject({ outcome: 'info', suppressed: { by: 'approval', approvedBy: 'design-system team' } });
    expect(local.find((f) => f.id === blocking.id)).toMatchObject({ outcome: 'fail' });

    // In CI the policy comes from the base branch: approvals a change adds to its own policy do not apply to it.
    fs.writeFileSync(policyPath, JSON.stringify(TEST_POLICY));
    commitAll(root);
    fs.writeFileSync(policyPath, approved);
    expect((await findings('--policy', policyPath, '--policy-ref', 'main')).find((f) => f.id === review.id)?.outcome).toBe('review');
  });

  it('stop matching when any line of a multi-line flagged span changes', async () => {
    const pill = (label: string) => `export function StatusPill() {\n  return <span className="pill">${label}</span>;\n}\n`;
    const { root, policyPath } = project({ 'src/app/StatusPill.tsx': pill('Live') });
    const reuse = (fs: F[]) => fs.find((f) => f.ruleId === 'components/reuse')!;
    const review = reuse(await findings('--policy', policyPath));
    expect(review.outcome).toBe('review');
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, approvals: [approve(review)] }));
    expect(reuse(await findings('--policy', policyPath)).outcome).toBe('info');
    fs.writeFileSync(path.join(root, 'src/app/StatusPill.tsx'), pill('Late')); // only the second line of the component changes
    expect(reuse(await findings('--policy', policyPath)).outcome).toBe('review');
  });

  it('must not name the same fingerprint twice', async () => {
    const { policyPath } = project({});
    const a = { fingerprint: '0123456789abcdef', rule: 'spacing/scale', reason: 'Accepted in design review', approvedBy: 'x', expires: '2099-01-01' };
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, approvals: [a, { ...a, approvedBy: 'y' }] }));
    const err: string[] = [];
    expect(await main(['policy', 'validate', '--policy', policyPath], () => {}, (s) => err.push(s))).toBe(2);
    expect(err.join('\n')).toContain('approvals.1.fingerprint: duplicate approval for 0123456789abcdef');
  });

  it('stop applying after their expiry date', async () => {
    const { policyPath } = project(files);
    const review = (await findings('--policy', policyPath)).find((f) => f.outcome === 'review')!;
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, approvals: [approve(review, '2026-10-09')] }));
    expect((await findings('--policy', policyPath)).find((f) => f.id === review.id)?.outcome).toBe('review');
  });

  it('must name a rule of the policy', async () => {
    const { policyPath } = project({});
    fs.writeFileSync(policyPath, JSON.stringify({ ...TEST_POLICY, approvals: [{ fingerprint: '0123456789abcdef', rule: 'no/such-rule', reason: 'Accepted in design review', approvedBy: 'x', expires: '2099-01-01' }] }));
    const err: string[] = [];
    expect(await main(['policy', 'validate', '--policy', policyPath], () => {}, (s) => err.push(s))).toBe(2);
    expect(err.join('\n')).toContain('approvals.0.rule: unknown rule "no/such-rule"');
  });
});

describe('policyChangeNotes', () => {
  it('names each approval that was added, changed or removed', () => {
    const a = { fingerprint: '0123456789abcdef', rule: 'spacing/scale', file: 'src/a.css', reason: 'Accepted in design review', approvedBy: 'ds', expires: '2099-01-01' };
    const withA = JSON.stringify({ ...TEST_POLICY, approvals: [a] });
    expect(policyChangeNotes(JSON.stringify(TEST_POLICY), withA)).toEqual(['Approval for spacing/scale at src/a.css (0123456789abcdef) was added.']);
    expect(policyChangeNotes(withA, JSON.stringify({ ...TEST_POLICY, approvals: [{ ...a, expires: '2100-01-01' }] }))).toEqual(['Approval for spacing/scale at src/a.css (0123456789abcdef) changed.']);
    expect(policyChangeNotes(withA, JSON.stringify(TEST_POLICY))).toEqual(['Approval for spacing/scale at src/a.css (0123456789abcdef) was removed.']);
    // Compared by content: a second entry for the same fingerprint cannot hide behind the first.
    expect(policyChangeNotes(withA, JSON.stringify({ ...TEST_POLICY, approvals: [{ ...a, approvedBy: 'someone else' }, a] }))).toEqual([
      'Approval for spacing/scale at src/a.css (0123456789abcdef) changed.',
    ]);
  });

  const base = JSON.stringify({ ...TEST_POLICY, exceptions: [{ id: 'a', rules: ['x'], paths: ['p'], reason: 'r' }] });
  it('reports exception and section changes, not only rules', () => {
    const head = JSON.stringify({ ...TEST_POLICY, project: { include: ['src/**/*.tsx'], exclude: ['src/**'] }, exceptions: [{ id: 'a', rules: ['x'], paths: ['**'], reason: 'r' }, { id: 'b', rules: ['y'], paths: ['q'], reason: 'r' }] });
    expect(policyChangeNotes(base, head)).toEqual(['Exception a changed (scope, rules, reason or expiry).', 'Exception b was added.', 'Policy section "project" changed.']);
    expect(policyChangeNotes(base, JSON.stringify(TEST_POLICY))).toEqual(['Exception a was removed.']);
  });
});

describe('report formats and scopes', () => {
  it('renders a markdown summary', async () => {
    const r = await cli('check', '--policy', project({ 'src/app/a.css': '.a { padding: 13px; }' }).policyPath, '--format', 'markdown');
    expect(r.out).toContain('## Design Warden: ❌ Fail');
    expect(r.out).toContain('| 🔴 fail | `spacing/scale` | src/app/a.css:1 |');
  });

  it('writes SARIF 2.1.0 with rules, levels from the outcome, locations and fingerprints, without suppressed findings', async () => {
    const policy = { ...TEST_POLICY, exceptions: [{ id: 'legacy', rules: ['color/no-literal'], paths: ['src/legacy/**'], reason: 'brand colours' }] };
    const { policyPath } = project(
      {
        'src/app/a.css': '.a {\n  padding: 13px;\n}',
        'src/app/A.tsx': 'export const A = ({ p }: { p: number }) => <div style={{ padding: p }} />;',
        'src/legacy/l.css': '.l { color: #ff6a00; }',
      },
      policy,
    );
    const r = await cli('check', '--policy', policyPath, '--format', 'sarif');
    expect(r.code).toBe(1);
    const sarif = JSON.parse(r.out);
    expect(sarif.version).toBe('2.1.0');
    const run = sarif.runs[0];
    expect(run.tool.driver).toMatchObject({ name: 'design-warden', rules: [{ id: 'spacing/scale', shortDescription: { text: 'spacing/scale' }, help: { text: 'fix it' } }] });
    const results = run.results.map((x: SarifResult) => [x.ruleId, x.ruleIndex, x.level, x.locations[0]!.physicalLocation.artifactLocation.uri, x.locations[0]!.physicalLocation.region.startLine]);
    expect(results).toHaveLength(2);
    expect(results).toEqual(expect.arrayContaining([['spacing/scale', 0, 'error', 'src/app/a.css', 2], ['spacing/scale', 0, 'warning', 'src/app/A.tsx', 1]]));
    expect(run.results.every((x: SarifResult) => /^[0-9a-f]{16}$/.test(x.partialFingerprints['designWarden/v1']!))).toBe(true);
  });

  it('makes SARIF paths relative to where the check ran, percent-encoded, and maps info to note', async () => {
    const { policyPath } = project({ 'src/app/my page#1.css': '.a { padding: 13px; }' });
    const report = JSON.parse((await cli('check', '--policy', policyPath, '--format', 'json')).out);
    report.target.root = 'apps/web';
    report.findings[0].outcome = 'info';
    const result: SarifResult = JSON.parse(renderSarif(report)).runs[0].results[0];
    expect(result.locations[0]!.physicalLocation.artifactLocation.uri).toBe('apps/web/src/app/my%20page%231.css');
    expect(result.level).toBe('note');
  });

  it('writes a GitLab Code Quality report with severities from the outcome and fingerprints, without suppressed findings', async () => {
    const policy = { ...TEST_POLICY, exceptions: [{ id: 'legacy', rules: ['color/no-literal'], paths: ['src/legacy/**'], reason: 'brand colours' }] };
    const { policyPath } = project(
      {
        'src/app/a.css': '.a {\n  padding: 13px;\n}',
        'src/app/A.tsx': 'export const A = ({ p }: { p: number }) => <div style={{ padding: p }} />;',
        'src/legacy/l.css': '.l { color: #ff6a00; }',
      },
      policy,
    );
    const r = await cli('check', '--policy', policyPath, '--format', 'gitlab');
    expect(r.code).toBe(1);
    const issues: { check_name: string; severity: string; description: string; fingerprint: string; location: { path: string; lines: { begin: number } } }[] = JSON.parse(r.out);
    expect(issues.map((i) => [i.check_name, i.severity, i.location.path, i.location.lines.begin])).toEqual(
      expect.arrayContaining([['spacing/scale', 'major', 'src/app/a.css', 2], ['spacing/scale', 'minor', 'src/app/A.tsx', 1]]),
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]!.description).toMatch(/^`13px` in `padding`|^inline style `padding`/);
    expect(new Set(issues.map((i) => i.fingerprint)).size).toBe(2);
  });

  it('gives GitLab repository-relative paths and leaves out findings without a location', async () => {
    const { policyPath } = project({ 'src/app/a.css': '.a { padding: 13px; }\n.b { margin: 13px; }' });
    const report = JSON.parse((await cli('check', '--policy', policyPath, '--format', 'json')).out);
    report.target.root = 'apps/web';
    delete report.findings[1].location;
    expect(JSON.parse(renderGitlab(report))).toEqual([expect.objectContaining({ location: { path: 'apps/web/src/app/a.css', lines: { begin: 1 } } })]);
  });

  it('compares with a base directory instead of a git ref (--base-dir)', async () => {
    const { root: baseDir } = project({ 'src/app/a.css': '.old { color: #123456; }\n' });
    const { policyPath } = project({ 'src/app/a.css': '.old { color: #123456; }\n.new { padding: 13px; }\n' });
    const r = await cli('check', '--policy', policyPath, '--base-dir', baseDir, '--format', 'json');
    const report = JSON.parse(r.out);
    expect(r.code).toBe(1);
    expect(report.target).toMatchObject({ base: { ref: baseDir, sha: '' }, scope: 'changed-lines', changedFiles: ['src/app/a.css'] });
    expect(report.findings.map((f: { ruleId: string; preexisting?: boolean }) => [f.ruleId, Boolean(f.preexisting)])).toEqual([
      ['spacing/scale', false],
      ['color/no-literal', true],
    ]);
  });

  it('refuses --base together with --base-dir', async () => {
    const { root, policyPath } = project({});
    const err: string[] = [];
    expect(await main(['check', '--policy', policyPath, '--base', 'main', '--base-dir', root], () => {}, (s) => err.push(s))).toBe(2);
    expect(err.join('\n')).toContain('--base and --base-dir cannot be combined');
  });

  it('reports a policy change under --base-dir even when the new policy excludes itself', async () => {
    const { root: baseDir } = project({});
    const { policyPath } = project({});
    const weakened = { ...TEST_POLICY, project: { ...TEST_POLICY.project, exclude: ['design-warden.policy.json'] }, rules: TEST_POLICY.rules.map((r) => (r.id === 'color/no-literal' ? { ...r, enforcement: 'report' } : r)) };
    fs.writeFileSync(policyPath, JSON.stringify(weakened));
    const report = JSON.parse((await cli('check', '--policy', policyPath, '--base-dir', baseDir, '--format', 'json')).out);
    expect(report.findings.find((f: { ruleId: string }) => f.ruleId === 'policy/changed')).toMatchObject({ outcome: 'review' });
  });

  it('changed-files scope also counts old violations in touched files', async () => {
    const { root, policyPath } = project({ 'src/app/a.css': '.old { color: #123456; }\n' });
    commitAll(root);
    writeFiles(root, { 'src/app/a.css': '.old { color: #123456; }\n.new { color: var(--color-text); }\n' });
    expect((await cli('check', '--policy', policyPath, '--base', 'main')).code).toBe(0); // old line is pre-existing
    expect((await cli('check', '--policy', policyPath, '--base', 'main', '--scope', 'changed-files')).code).toBe(1);
  });
});

describe('capture command', () => {
  const visualPolicy = {
    ...TEST_POLICY,
    visual: { viewports: [{ id: 'd', width: 320, height: 200 }], routes: [{ id: 'home', path: '/', states: [{ id: 'default', waitFor: 'main' }] }] },
  };

  it('captures a served directory and writes a manifest', async () => {
    const { policyPath } = project({}, visualPolicy);
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cap-site-'));
    fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><main>hello</main>');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cap-out-'));
    const r = await cli('capture', '--policy', policyPath, '--serve', site, '--out', out);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).captures[0]).toMatchObject({ id: 'home/default/d', file: 'home__default__d.png' });
  }, 60_000);

  it('runs axe during capture and reports accessibility violations new in head, for review (accessibility check)', async () => {
    const policy = {
      ...visualPolicy,
      rules: [...TEST_POLICY.rules, { id: 'a11y/axe', version: 1, title: 'Accessible states', category: 'preferred', description: 'd', rationale: 'r', verify: { by: 'check', check: 'accessibility', options: { tags: ['wcag2a'] } }, remediation: 'fix it' }],
    };
    const { policyPath } = project({}, visualPolicy);
    fs.writeFileSync(policyPath, JSON.stringify(policy)); // the CLI loads it with every check; the helper knows source checks only
    const capture = async (html: string) => {
      const site = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-a11y-site-'));
      fs.writeFileSync(path.join(site, 'index.html'), html);
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-a11y-out-'));
      expect((await cli('capture', '--policy', policyPath, '--serve', site, '--out', out)).code).toBe(0);
      return out;
    };
    const base = await capture('<!doctype html><html lang="en"><head><title>Home</title></head><main>hello</main></html>');
    const head = await capture('<!doctype html><html><head><title>Home</title></head><main>hello</main></html>');
    const r = JSON.parse((await cli('check', '--policy', policyPath, '--visual-base', base, '--visual-head', head, '--only', 'visual', '--format', 'json')).out);
    expect(r.findings.map((f: { ruleId: string; outcome: string; message: string }) => [f.ruleId, f.outcome, f.message.split(':')[0]])).toEqual([['a11y/axe', 'review', 'html-has-lang (serious) on home/default (d)']]);
    expect(JSON.parse(fs.readFileSync(path.join(head, 'manifest.json'), 'utf8')).axe).toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/), tags: ['wcag2a'] });

    // Rendered styles differ between environments too, so accessibility results are compared only within one, as pixels are.
    const manifest = path.join(base, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    fs.writeFileSync(manifest, JSON.stringify({ ...m, fingerprint: { ...m.fingerprint, platform: 'elsewhere' } }));
    const elsewhere = JSON.parse((await cli('check', '--policy', policyPath, '--visual-base', base, '--visual-head', head, '--only', 'visual', '--format', 'json')).out);
    expect(elsewhere.engines.find((e: { engine: string }) => e.engine === 'visual')).toMatchObject({ status: 'failed', reason: expect.stringMatching(/^refusing to compare captures from different environments/) });
  }, 120_000);

  it('compares new captures with a committed baseline, and refuses a baseline from another environment', async () => {
    const policy = { ...visualPolicy, rules: [...TEST_POLICY.rules, { id: 'visual/changes', version: 1, title: 'Visual changes', category: 'preferred', description: 'd', rationale: 'r', verify: { by: 'check', check: 'visual-diff' }, remediation: 'fix it' }] };
    const { root, policyPath } = project({}, visualPolicy);
    fs.writeFileSync(policyPath, JSON.stringify(policy)); // the CLI loads it with every check; the helper knows source checks only
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-baseline-site-'));
    fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><main>hello</main>');
    const baseline = path.join(root, 'design-warden-baseline'); // committed with the code
    expect((await cli('capture', '--policy', policyPath, '--serve', site, '--out', baseline)).code).toBe(0);

    fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><main>hello, world</main>');
    const head = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-baseline-head-'));
    expect((await cli('capture', '--policy', policyPath, '--serve', site, '--out', head)).code).toBe(0);
    const compare = async () => JSON.parse((await cli('check', '--policy', policyPath, '--visual-base', baseline, '--visual-head', head, '--only', 'visual', '--format', 'json')).out);
    expect((await compare()).findings.map((f: { ruleId: string; outcome: string }) => [f.ruleId, f.outcome])).toEqual([['visual/changes', 'review']]);

    const manifest = path.join(baseline, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), fingerprint: { ...JSON.parse(fs.readFileSync(manifest, 'utf8')).fingerprint, platform: 'elsewhere' } }));
    const elsewhere = await compare();
    expect(elsewhere.engines.find((e: { engine: string }) => e.engine === 'visual')).toMatchObject({ status: 'failed', reason: expect.stringContaining('Capture both with the same Playwright version, browser, platform and scale') });
    expect(elsewhere.outcome).toBe('review'); // the visual engine's failure policy
  }, 120_000);

  it('exits 3 when nothing could be captured', async () => {
    const { policyPath } = project({}, visualPolicy);
    const r = await cli('capture', '--policy', policyPath, '--url', 'http://127.0.0.1:9', '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cap-none-')));
    expect(r.code).toBe(3);
    expect(r.out).toContain('No state could be captured');
  }, 60_000);

  it('exits 2 before starting a browser when the --serve directory has no index.html', async () => {
    const { policyPath } = project({}, visualPolicy);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cap-empty-'));
    const r = await cli('capture', '--policy', policyPath, '--serve', empty, '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cap-none-')));
    expect([r.code, r.err.trim()]).toEqual([2, `design-warden: --serve ${empty} has no index.html; build the app first, or pass the directory that contains it`]);
  });
});
