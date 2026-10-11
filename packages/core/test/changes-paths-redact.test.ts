import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChangeSetError, dirChangeSet, isLineChanged, listFiles, parseNameStatus, parseUnifiedDiff, redactSecrets, resolveInside } from '../src/index.ts';

describe('parseUnifiedDiff', () => {
  const diff = [
    'diff --git a/src/a.tsx b/src/a.tsx',
    'index 1..2 100644',
    '--- a/src/a.tsx',
    '+++ b/src/a.tsx',
    '@@ -3 +3 @@ x',
    '-old',
    '+new',
    '@@ -10,2 +9,0 @@',
    '-gone',
    '-gone',
    '@@ -20,0 +19,3 @@',
    '+a',
    'diff --git a/src/new.css b/src/new.css',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.css',
    '@@ -0,0 +1,4 @@',
    'diff --git a/src/old.tsx b/src/old.tsx',
    'deleted file mode 100644',
    '--- a/src/old.tsx',
    '+++ /dev/null',
    '@@ -1,5 +0,0 @@',
    'diff --git a/src/x.tsx b/src/y.tsx',
    'similarity index 100%',
    'rename from src/x.tsx',
    'rename to src/y.tsx',
  ].join('\n');

  const files = parseUnifiedDiff(diff);

  it('reads statuses and paths', () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/a.tsx', 'modified'],
      ['src/new.css', 'added'],
      ['src/old.tsx', 'deleted'],
      ['src/y.tsx', 'renamed'],
    ]);
    expect(files[3]?.previousPath).toBe('src/x.tsx');
  });

  it('records changed line ranges, including the border of pure deletions', () => {
    const a = files[0]!;
    expect(a.changedLines).toEqual([
      { start: 3, end: 3 },
      { start: 9, end: 10 },
      { start: 19, end: 21 },
    ]);
    expect(isLineChanged(a, 3)).toBe(true);
    expect(isLineChanged(a, 5)).toBe(false);
    expect(isLineChanged(a, 4, 9)).toBe(true); // a multi-line element spanning a deletion
  });
});

describe('parseNameStatus and awkward file names', () => {
  it('reads NUL-separated name-status output, including renames, copies and spaces', () => {
    const out = ['M', 'src/a b.css', 'R087', 'src/old.tsx', 'src/new.tsx', 'C100', 'src/x.css', 'src/y.css', 'D', 'src/gone.tsx', 'A', 'src/"q".css', ''].join('\0');
    expect(parseNameStatus(out)).toEqual([
      { path: 'src/a b.css', status: 'modified' },
      { path: 'src/new.tsx', status: 'renamed', previousPath: 'src/old.tsx' },
      { path: 'src/y.css', status: 'added' },
      { path: 'src/gone.tsx', status: 'deleted' },
      { path: 'src/"q".css', status: 'added' },
    ]);
  });

  it('reads patch paths that git suffixes with a tab or quotes', () => {
    const diff = ['diff --git a/x b/x', '--- a/src/a b.css\t', '+++ b/src/a b.css\t', '@@ -1 +1 @@', 'diff --git a/y b/y', '--- "a/src/\\"q\\".css"', '+++ "b/src/\\"q\\".css"', '@@ -2 +2 @@'].join('\n');
    expect(parseUnifiedDiff(diff).map((f) => f.path)).toEqual(['src/a b.css', 'src/"q".css']);
  });
});

describe('dirChangeSet', () => {
  const tree = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-tree-'));
    for (const [p, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
      fs.writeFileSync(path.join(root, p), c);
    }
    return root;
  };

  it('compares two directory trees without git: added, modified with line ranges, deleted, included files only', async () => {
    const base = tree({ 'src/same.css': 'a\n', 'src/mod.css': 'a\nb\nc\n', 'src/gone.css': 'x\n', 'README.md': 'old' });
    const head = tree({ 'src/same.css': 'a\n', 'src/mod.css': 'a\nB\nc\n', 'src/new file.css': 'n\n', 'node_modules/x/i.css': 'junk', 'README.md': 'new' });
    const cs = await dirChangeSet(head, base, ['**/*.css'], []);
    expect(cs.base).toEqual({ ref: base, sha: '' });
    expect(cs.files).toEqual([
      { path: 'src/mod.css', status: 'modified', changedLines: [{ start: 2, end: 2 }] },
      { path: 'src/new file.css', status: 'added', changedLines: [{ start: 1, end: Number.MAX_SAFE_INTEGER }] },
      { path: 'src/gone.css', status: 'deleted', changedLines: [] },
    ]);
  });

  it('passes a file named like an option safely (a file called "-" must not make git read stdin)', async () => {
    const cs = await dirChangeSet(tree({ '-': 'b\n' }), tree({ '-': 'a\n' }), ['*'], []);
    expect(cs.files).toEqual([{ path: '-', status: 'modified', changedLines: [{ start: 1, end: 1 }] }]);
  }, 15_000);

  it('always compares the given files, even when the policy filters exclude them', async () => {
    const cs = await dirChangeSet(tree({ 'policy.json': '{"a":2}\n' }), tree({ 'policy.json': '{"a":1}\n' }), ['src/**'], ['policy.json'], ['policy.json']);
    expect(cs.files.map((f) => f.path)).toEqual(['policy.json']);
  });

  it('rejects a base directory that does not exist', async () => {
    await expect(dirChangeSet(tree({}), path.join(os.tmpdir(), 'dw-no-such-dir'), ['**/*'], [])).rejects.toThrow(ChangeSetError);
  });
});

describe('resolveInside', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-paths-'));
  fs.mkdirSync(path.join(root, 'src'));

  it.each(['../etc/passwd', 'src/../../x', '/etc/passwd', 'C:\\Windows\\win.ini', 'C:/x', 'a\0b'])('rejects %s', (p) => {
    expect(() => resolveInside(root, p)).toThrow();
  });

  it('rejects a path that leaves the root through a symlink or junction', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction'); // junctions need no admin rights on Windows
    expect(() => resolveInside(root, 'link/secret.txt')).toThrow(/through a symlink/);
  });

  it('accepts paths inside the root', () => {
    expect(resolveInside(root, 'src/a.tsx')).toBe(path.join(root, 'src', 'a.tsx'));
  });

  it('lists files by include/exclude globs as POSIX paths', () => {
    fs.mkdirSync(path.join(root, 'src', 'ds'), { recursive: true });
    for (const f of ['src/a.tsx', 'src/b.css', 'src/ds/c.tsx', 'src/a.test.tsx']) fs.writeFileSync(path.join(root, f), '');
    expect(listFiles(root, ['src/**/*.{tsx,css}'], ['**/*.test.tsx'])).toEqual(['src/a.tsx', 'src/b.css', 'src/ds/c.tsx']);
  });
});

describe('redactSecrets', () => {
  it('redacts common secret formats and keeps line structure', () => {
    const input = [
      'const a = "AKIAABCDEFGHIJKLMNOP";',
      'const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";',
      'apiKey: "super-secret-value-123",',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA',
      '-----END RSA PRIVATE KEY-----',
      'const color = "#ffffff";',
    ].join('\n');
    const { text, redactions } = redactSecrets(input);
    expect(redactions).toBe(4);
    expect(text.split('\n')).toHaveLength(7);
    expect(text).not.toMatch(/AKIA|sk-ant|super-secret|MIIE/);
    expect(text).toContain('#ffffff');
  });

  it.each([
    ['GitHub token', `ghp_${'a'.repeat(36)}`],
    ['GitHub fine-grained token', `github_pat_${'b'.repeat(50)}`],
    ['OpenAI-style key', `sk-proj-${'c'.repeat(40)}`],
    ['Slack token', 'xoxb-1234567890-abcdefghij'],
    ['Google API key', `AIza${'d'.repeat(35)}`],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
    ['client secret assignment', 'client_secret = "s3cr3t-value-123"'],
  ])('redacts a %s', (_name, secret) => {
    const { text, redactions } = redactSecrets(secret.includes('=') ? secret : `const x = "${secret}";`);
    expect(redactions).toBeGreaterThan(0);
    expect(text).not.toContain(secret.slice(-12));
  });
});
