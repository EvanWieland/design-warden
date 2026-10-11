import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { listFiles, resolveInside } from './paths.ts';

const run = promisify(execFile);

export class ChangeSetError extends Error {
  override name = 'ChangeSetError';
}

/** Inclusive 1-based line range in the head (current) version of a file. */
export interface LineRange {
  start: number;
  end: number;
}

export interface FileChange {
  path: string; // POSIX, relative to the project root
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  previousPath?: string;
  /** Renames: how similar the two versions are, 0–100 as git reports it (100: identical content). */
  similarity?: number;
  /** Added or rewritten lines, plus the lines bordering pure deletions. */
  changedLines: LineRange[];
}

export interface ChangeSet {
  base: { ref: string; sha: string };
  files: FileChange[];
}

/** Runs git without a shell. Arguments are never interpolated into a command line. */
async function git(cwd: string, args: string[], okExitCodes: readonly number[] = [0]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-c', 'core.quotePath=false', '-c', 'core.longpaths=true', ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message: string };
    if (e.code !== undefined && okExitCodes.includes(e.code) && e.stdout !== undefined) return e.stdout;
    throw new ChangeSetError(`git ${args[0]} failed: ${(e.stderr || e.message).trim()}`);
  }
}

/** Resolves a user-supplied ref to a commit SHA. Refs that look like options are rejected. */
export async function resolveCommit(cwd: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-')) throw new ChangeSetError(`invalid git ref "${ref}"`);
  try {
    return (await git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).trim();
  } catch {
    throw new ChangeSetError(
      `unknown git ref "${ref}". In CI, fetch enough history (actions/checkout with fetch-depth: 0).`,
    );
  }
}

/**
 * Changes between the merge base of `baseRef` and HEAD, and the working tree,
 * including untracked files. Scoped to `projectRoot` (which may be a subdirectory of the repository).
 */
export async function gitChangeSet(projectRoot: string, baseRef: string): Promise<ChangeSet> {
  const baseSha = await resolveCommit(projectRoot, baseRef);
  const mergeBase = (await git(projectRoot, ['merge-base', baseSha, 'HEAD'])).trim();
  // Which files changed comes from NUL-separated name-status output, which no file name or
  // .gitattributes setting can disguise. The patch is only used for line ranges.
  const names = parseNameStatus(await git(projectRoot, ['diff', '--name-status', '-z', '-M', '--relative', mergeBase]));
  const hunks = new Map(parseUnifiedDiff(await git(projectRoot, [...PATCH_OPTIONS, '--relative', '-M', mergeBase])).map((f) => [f.path, f.changedLines]));
  const files: FileChange[] = names.map((n) => ({
    ...n,
    // A pure rename changes no lines: its findings stay pre-existing. Otherwise fail closed: if the line
    // ranges of a changed file cannot be read, treat the whole file as changed.
    changedLines: n.status === 'renamed' && n.similarity === 100 ? [] : hunks.get(n.path)?.length ? hunks.get(n.path)! : WHOLE_FILE,
  }));
  const untracked = await git(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  for (const p of untracked.split('\0').filter(Boolean)) files.push({ path: p, status: 'added', changedLines: WHOLE_FILE });
  return { base: { ref: baseRef, sha: mergeBase }, files };
}

const WHOLE_FILE: LineRange[] = [{ start: 1, end: Number.MAX_SAFE_INTEGER }];

// Patch options for line ranges. --text: a pull request's own .gitattributes ("-diff", "binary") must
// not hide content changes. Explicit prefixes and no textconv/external drivers: user git config must
// not change the format.
const PATCH_OPTIONS = ['diff', '--text', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '-U0'];

/** git's default rename threshold (`-M50%`). */
const RENAME_SIMILARITY = 50;
// ponytail: unmatched added and deleted files are compared pairwise (same extension only); above this many
// comparisons only identical files pair as renames. Upgrade: bucket candidates by content fingerprints.
const MAX_RENAME_COMPARISONS = 25_000;

/** Lines two texts share, as multisets, 0–100: an approximation of git's similarity index. */
function similarity(a: string, b: string): number {
  const lines = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s).split('\n');
  const [la, lb] = [lines(a), lines(b)];
  const left = new Map<string, number>();
  for (const l of la) left.set(l, (left.get(l) ?? 0) + 1);
  let common = 0;
  for (const l of lb) {
    const n = left.get(l) ?? 0;
    if (n > 0) {
      common++;
      left.set(l, n - 1);
    }
  }
  return Math.round((200 * common) / (la.length + lb.length));
}

/** Pairs added files with deleted ones: identical content first, then the most similar file with the same extension, at least 50%. */
function findRenames(projectRoot: string, baseDir: string, added: string[], deleted: string[]): Map<string, { from: string; similarity: number }> {
  const out = new Map<string, { from: string; similarity: number }>();
  if (!added.length || !deleted.length) return out;
  const cache = new Map<string, Buffer>();
  const bytes = (file: string) => cache.get(file) ?? (cache.set(file, fs.readFileSync(file)), cache.get(file)!);
  const [head, base] = [(p: string) => bytes(path.join(projectRoot, p)), (p: string) => bytes(path.join(baseDir, p))];
  const free = new Set(deleted);
  const byHash = new Map(deleted.map((d) => [createHash('sha256').update(base(d)).digest('hex'), d]));
  for (const a of added) {
    const d = byHash.get(createHash('sha256').update(head(a)).digest('hex'));
    if (d && free.has(d)) {
      out.set(a, { from: d, similarity: 100 });
      free.delete(d);
    }
  }
  const rest = added.filter((a) => !out.has(a));
  if (rest.length * free.size > MAX_RENAME_COMPARISONS) return out;
  const candidates: [number, string, string][] = [];
  for (const a of rest) {
    for (const d of free) {
      if (path.extname(a) !== path.extname(d)) continue;
      const s = similarity(head(a).toString('utf8'), base(d).toString('utf8'));
      if (s >= RENAME_SIMILARITY) candidates.push([s, a, d]);
    }
  }
  candidates.sort((x, y) => y[0] - x[0]);
  for (const [s, a, d] of candidates) {
    if (out.has(a) || !free.has(d)) continue;
    out.set(a, { from: d, similarity: s });
    free.delete(d);
  }
  return out;
}

/**
 * Changes from `baseDir`, an older copy of the project, to `projectRoot`, without git history.
 * Both trees are listed with the same globs (`git diff --no-index` would include node_modules and
 * ignore .gitignore); files whose bytes differ are diffed with `git diff --no-index`, which works
 * outside a repository. A deleted and an added file that are identical or similar pair as a rename,
 * as git would report it. `base.sha` is empty.
 */
export async function dirChangeSet(projectRoot: string, baseDir: string, include: readonly string[], exclude: readonly string[], always: readonly string[] = []): Promise<ChangeSet> {
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) throw new ChangeSetError(`base directory "${baseDir}" does not exist`);
  // `always` (the policy file, token sources) is compared whatever the filters say: the head policy
  // must not be able to exclude itself and hide its own change.
  const files = (root: string) => {
    const extra = always.filter((p) => {
      const abs = resolveInside(root, p);
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    });
    return [...new Set([...listFiles(root, include, exclude), ...extra])].sort();
  };
  const head = files(projectRoot);
  const base = new Set(files(baseDir));
  const current = new Set(head);
  const renames = findRenames(projectRoot, baseDir, head.filter((p) => !base.has(p)), [...base].filter((p) => !current.has(p)));
  const renamedFrom = new Set([...renames.values()].map((r) => r.from));
  const changes: FileChange[] = [];
  for (const p of head) {
    const rename = renames.get(p);
    if (!base.has(p) && !rename) {
      changes.push({ path: p, status: 'added', changedLines: WHOLE_FILE });
      continue;
    }
    const from = rename?.from ?? p;
    const renamed = rename ? ({ status: 'renamed', previousPath: from, similarity: rename.similarity } as const) : ({ status: 'modified' } as const);
    if (fs.readFileSync(path.join(baseDir, from)).equals(fs.readFileSync(path.join(projectRoot, p)))) {
      if (rename) changes.push({ path: p, ...renamed, changedLines: [] }); // a pure rename changes no lines
      continue;
    }
    // Exit code 1 means "the files differ". Same fail-closed rule as gitChangeSet: no hunks, whole file.
    // `./`: a file named `-` would otherwise make git read stdin.
    const diff = await git(projectRoot, [...PATCH_OPTIONS, '--no-index', '--', path.resolve(baseDir, from), `./${p}`], [0, 1]);
    const changedLines = parseUnifiedDiff(diff)[0]?.changedLines;
    changes.push({ path: p, ...renamed, changedLines: changedLines?.length ? changedLines : WHOLE_FILE });
  }
  for (const p of base) if (!current.has(p) && !renamedFrom.has(p)) changes.push({ path: p, status: 'deleted', changedLines: [] });
  return { base: { ref: baseDir, sha: '' }, files: changes };
}

/** Parses `git diff --name-status -z`. Exported for tests. */
export function parseNameStatus(out: string): Omit<FileChange, 'changedLines'>[] {
  const parts = out.split('\0');
  const files: Omit<FileChange, 'changedLines'>[] = [];
  for (let i = 0; i < parts.length - 1; ) {
    const code = parts[i++]!;
    if (code.startsWith('R') || code.startsWith('C')) {
      const [from, to] = [parts[i++]!, parts[i++]!];
      files.push(code.startsWith('R') ? { path: to, status: 'renamed', previousPath: from, similarity: Number(code.slice(1)) } : { path: to, status: 'added' });
    } else {
      const p = parts[i++]!;
      files.push({ path: p, status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified' });
    }
  }
  return files;
}

/** Content of a project file at a commit, or null when it did not exist there. */
export async function readFileAtCommit(projectRoot: string, sha: string, file: string): Promise<string | null> {
  try {
    return await git(projectRoot, ['show', `${sha}:./${file}`]);
  } catch {
    return null;
  }
}

/** Parses `git diff -U0` output. Exported for tests. */
export function parseUnifiedDiff(diff: string): FileChange[] {
  const files: FileChange[] = [];
  let cur: FileChange | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: '', status: 'modified', changedLines: [] };
      files.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('new file mode')) {
      cur.status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      cur.status = 'deleted';
    } else if (line.startsWith('rename from ')) {
      cur.status = 'renamed';
      cur.previousPath = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      cur.path = unquote(line.slice('rename to '.length));
    } else if (line.startsWith('--- ') && !cur.path) {
      cur.path = diffPath(line, 'a/') ?? ''; // provisional: deleted files have no "+++ b/" line
    } else if (line.startsWith('+++ ')) {
      cur.path = diffPath(line, 'b/') ?? cur.path;
    } else if (line.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // A pure deletion touches the lines on either side of where the text used to be.
      cur.changedLines.push(count > 0 ? { start, end: start + count - 1 } : { start: Math.max(1, start), end: start + 1 });
    }
  }
  return files.filter((f) => f.path);
}

/** Path from a `--- a/x` or `+++ b/x` line; null for /dev/null. */
function diffPath(line: string, prefix: string): string | null {
  let p = line.slice(4);
  if (p.endsWith('\t')) p = p.slice(0, -1); // git appends a tab when the name contains a space
  p = unquote(p);
  return p.startsWith(prefix) ? p.slice(prefix.length) : null;
}

/** Git quotes names with special characters C-style ("a\"b"). */
function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  try {
    return JSON.parse(p) as string;
  } catch {
    return p.slice(1, -1);
  }
}

export const isLineChanged = (change: FileChange, start: number, end = start): boolean =>
  change.changedLines.some((r) => start <= r.end && end >= r.start);
