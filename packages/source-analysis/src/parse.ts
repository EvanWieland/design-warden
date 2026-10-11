import { parse as babelParse } from '@babel/parser';
import type { File, Node } from '@babel/types';
import postcss, { type Root } from 'postcss';
import scss from 'postcss-scss';
import { parseSvelte } from './svelte.ts';
import type { TemplateParts } from './templates.ts';
import { parseVue } from './vue.ts';

export interface Directive {
  /** Line the directive applies to (the line after the comment). */
  targetLine: number;
  commentLine: number;
  ruleId: string | null;
  reason: string | null;
}

export interface ParsedFile {
  path: string;
  kind: 'tsx' | 'ts' | 'js' | 'css' | 'json' | 'vue' | 'svelte';
  text: string;
  lines: string[];
  ast?: File;
  css?: Root;
  /** For .vue and .svelte files: the markup and the style blocks; `ast` is then the script. */
  template?: TemplateParts;
  error?: string;
  directives: Directive[];
}

export function fileKind(path: string): ParsedFile['kind'] | null {
  if (/\.tsx$/.test(path)) return 'tsx';
  if (/\.(ts|mts|cts)$/.test(path)) return 'ts';
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return 'js'; // JavaScript with JSX, which React projects often keep in .js files
  if (/\.s?css$/.test(path)) return 'css'; // SCSS is parsed with postcss-scss into the same tree
  if (/\.json$/.test(path)) return 'json'; // DTCG token sources only (see analyzeSource)
  if (/\.vue$/.test(path)) return 'vue';
  if (/\.svelte$/.test(path)) return 'svelte';
  return null;
}

/** Parses with real parsers (Babel for TS, TSX and JS with JSX, PostCSS for CSS, the Vue and Svelte compilers for their files). Syntax errors are captured, not thrown. */
export function parseFile(path: string, text: string): ParsedFile {
  const kind = fileKind(path);
  if (!kind) throw new Error(`unsupported file type: ${path}`);
  const file: ParsedFile = { path, kind, text, lines: text.split(/\r?\n/), directives: [] };
  try {
    if (kind === 'json') {
      JSON.parse(text); // a syntax error makes the file unparseable, like broken CSS
    } else if (kind === 'css') {
      file.css = (path.endsWith('.scss') ? scss : postcss).parse(text, { from: path });
      file.css.walkComments((c) => addDirective(file, c.text, c.source?.end?.line ?? c.source?.start?.line));
    } else {
      let source = text;
      let jsx = kind === 'tsx';
      if (kind === 'vue' || kind === 'svelte') {
        const t = kind === 'vue' ? parseVue(text) : parseSvelte(text);
        file.template = t.parts;
        for (const c of t.comments) addDirective(file, c.text, c.line);
        [source, jsx] = [t.script, t.scriptJsx];
      }
      file.ast = babelParse(source, {
        sourceType: 'module',
        plugins: kind === 'js' ? ['jsx'] : jsx ? ['typescript', 'jsx'] : ['typescript'],
      }) as unknown as File;
      for (const c of (file.ast as File & { comments?: { value: string; loc?: { end: { line: number } } | null }[] }).comments ?? []) {
        addDirective(file, c.value, c.loc?.end.line);
      }
    }
  } catch (err) {
    file.error = (err as Error).message.split('\n')[0];
  }
  return file;
}

// design-warden-ignore-next-line <rule-id> -- <reason>
const DIRECTIVE = /design-warden-ignore-next-line(?:\s+([^\s]+))?(?:\s+--\s*(.*))?/;

function addDirective(file: ParsedFile, comment: string, line: number | undefined) {
  const m = DIRECTIVE.exec(comment);
  if (!m || line === undefined) return;
  const reason = m[2]?.replace(/\*\/\s*$/, '').trim() || null;
  file.directives.push({ commentLine: line, targetLine: line + 1, ruleId: m[1] ?? null, reason });
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range', 'comments', 'errors', 'tokens']);

/** Depth-first walk over a Babel AST. `ancestors` is the path from the root to the parent. */
export function walk(node: Node, enter: (node: Node, ancestors: readonly Node[]) => void, ancestors: Node[] = []): void {
  enter(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, enter, ancestors);
    } else if (isNode(value)) {
      walk(value, enter, ancestors);
    }
  }
  ancestors.pop();
}

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

export const lineOf = (node: Node): number => node.loc?.start.line ?? 1;
export const snippetAt = (file: ParsedFile, line: number): string => (file.lines[line - 1] ?? '').trim().slice(0, 240);
