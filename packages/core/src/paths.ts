import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {
  override name = 'PathError';
}

export const toPosix = (p: string): string => p.split(path.sep).join('/');

/**
 * Resolves a project-relative path and refuses anything that escapes the root,
 * including absolute paths, `..` segments and symlinks pointing outside.
 * Every path that comes from a policy file, a report or a model goes through here.
 */
export function resolveInside(root: string, rel: string): string {
  if (rel.includes('\0')) throw new PathError(`invalid path "${rel}"`);
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    throw new PathError(`absolute paths are not allowed: "${rel}"`);
  }
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, rel);
  if (!isWithin(absRoot, abs)) throw new PathError(`path escapes the project root: "${rel}"`);
  if (fs.existsSync(abs) && !isWithin(fs.realpathSync(absRoot), fs.realpathSync(abs))) {
    throw new PathError(`path resolves outside the project root through a symlink: "${rel}"`);
  }
  return abs;
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Locale-independent string order, so reports sort the same on every machine. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const matchesAny = (file: string, globs: readonly string[]): boolean =>
  globs.some((g) => path.posix.matchesGlob(file, g));

/** True when `file` is selected by include globs and not removed by exclude globs. */
export const inScope = (file: string, include: readonly string[], exclude: readonly string[]): boolean =>
  matchesAny(file, include) && !matchesAny(file, exclude);

/** Lists project files matching include/exclude, as sorted project-relative POSIX paths. */
export function listFiles(root: string, include: readonly string[], exclude: readonly string[]): string[] {
  const absRoot = fs.realpathSync(path.resolve(root));
  const found = new Set<string>();
  for (const pattern of include) {
    for (const match of fs.globSync(pattern, { cwd: absRoot, exclude: (p) => p.includes('node_modules') })) {
      const rel = toPosix(match);
      if (!inScope(rel, include, exclude)) continue;
      const abs = path.join(absRoot, match);
      if (!fs.statSync(abs).isFile() || !isWithin(absRoot, fs.realpathSync(abs))) continue;
      found.add(rel);
    }
  }
  return [...found].sort();
}
