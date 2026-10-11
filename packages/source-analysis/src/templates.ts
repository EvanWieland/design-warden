// Component templates (Vue, Svelte) as neutral elements, so the JSX checks and style checks run on
// them unchanged. Adapters (vue.ts, svelte.ts) translate their parser's tree into these.
import { parseExpression } from '@babel/parser';
import type { JSXAttribute, Node } from '@babel/types';
import postcss, { type Root } from 'postcss';
import scss from 'postcss-scss';
import type { ComponentDefinition, ImportBinding, JsxUsage, Resolved } from './jsx.ts';
import type { ParsedFile } from './parse.ts';

export interface TemplateElement {
  tag: string;
  component: boolean;
  /** Set when the tag is chosen at runtime (`<component :is>`, `<svelte:element this>`). */
  dynamic?: string;
  line: number;
  endLine: number;
  /** Babel-like values: a string literal, or an expression container. */
  attributes: { name: string; value: Node | true }[];
  spread: boolean;
  parent?: TemplateElement;
}

export interface TemplateParts {
  /** Lines of the markup, for change scoping of the component it defines. */
  line: number;
  endLine: number;
  elements: TemplateElement[];
  /** `<style>` blocks, each parsed on its own; `origin` is the file offset of its first character. */
  styles: { root: Root; sass: boolean; origin: number }[];
}

/** A `<style>` block parsed on its own (CSS or SCSS). Throws for other languages, which then make the file unparseable. */
export function styleBlock(text: string, pos: PositionOf, start: number, end: number, lang: string, comments: ParsedTemplate['comments']): TemplateParts['styles'][number] {
  const l = lang || 'css';
  if (l !== 'css' && l !== 'scss') throw new Error(`<style lang="${l}"> is not supported (CSS and SCSS are)`);
  const root = (l === 'scss' ? scss : postcss).parse(text.slice(start, end));
  root.walkComments((c) => void comments.push({ text: c.text, line: pos(start + (c.source?.end?.offset ?? 0)).line }));
  return { root, sass: l === 'scss', origin: start };
}

/** What an adapter returns: the template, the script text (rest of the file blanked), and comments for directives. */
export interface ParsedTemplate {
  parts: TemplateParts;
  script: string;
  scriptJsx: boolean;
  comments: { text: string; line: number }[];
}

/** The file text with everything outside the ranges replaced by spaces (line breaks kept), so parsers report file positions. */
export const keepRanges = (text: string, ranges: [number, number][]) => {
  const parts: string[] = [];
  let at = 0;
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    parts.push(text.slice(at, s).replace(/[^\r\n]/g, ' '), text.slice(s, e));
    at = e;
  }
  parts.push(text.slice(at).replace(/[^\r\n]/g, ' '));
  return parts.join('');
};

export type PositionOf = (offset: number) => { line: number; column: number };

/** Line (1-based) and column (0-based, as Babel) of any offset in the text. */
export function positions(text: string): PositionOf {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let [lo, hi] = [0, starts.length - 1];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! };
  };
}

/** A string literal spanning [start, end), where start is the opening quote (as Babel's StringLiteral). */
export const stringNode = (pos: PositionOf, value: string, start: number, end: number): Node =>
  ({ type: 'StringLiteral', value, start, end, loc: { start: pos(start), end: pos(end) } }) as unknown as Node;

/** The source text in [start, end) parsed as an expression at its position; unparseable text stays an opaque identifier. */
export function expressionNode(text: string, pos: PositionOf, start: number, end: number): Node {
  const at = pos(start);
  try {
    return parseExpression(text.slice(start, end), { plugins: ['typescript'], startIndex: start, startLine: at.line, startColumn: at.column }) as unknown as Node;
  } catch {
    return { type: 'Identifier', name: text.slice(start, end), start, end, loc: { start: at, end: pos(end) } } as unknown as Node;
  }
}

/** An identifier over [start, end), for shorthands that pass a variable of the same name (`:tone`, `{#snippet emptyState()}`). */
export const identifierNode = (pos: PositionOf, name: string, start: number, end: number): Node =>
  ({ type: 'Identifier', name, start, end, loc: { start: pos(start), end: pos(end) } }) as unknown as Node;

export const container = (expression: Node): Node => ({ type: 'JSXExpressionContainer', expression }) as unknown as Node;

export const pascal = (tag: string) => tag.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

/** Template elements as usages, resolved through the script's imports. Unimported component tags are global components. */
/**
 * Components a Vue file registers itself, which win over global registrations: an Options API
 * `components: { Alias: Imported }` map (to the import, or null), and every other top-level script binding (null).
 */
function localComponents(file: ParsedFile, byLocal: Map<string, ImportBinding>): Map<string, ImportBinding | null> {
  const out = new Map<string, ImportBinding | null>();
  const keyOf = (k: Node) => (k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null);
  for (const stmt of file.ast?.program.body ?? []) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier') out.set(d.id.name, null);
    if ((decl?.type === 'FunctionDeclaration' || decl?.type === 'ClassDeclaration') && decl.id) out.set(decl.id.name, null);
    if (stmt.type !== 'ExportDefaultDeclaration') continue;
    const d = stmt.declaration; // export default { … } or export default defineComponent({ … })
    const options = d.type === 'ObjectExpression' ? d : d.type === 'CallExpression' && d.arguments[0]?.type === 'ObjectExpression' ? d.arguments[0] : undefined;
    const map = options?.properties.find((p) => p.type === 'ObjectProperty' && !p.computed && keyOf(p.key) === 'components');
    if (map?.type !== 'ObjectProperty' || map.value.type !== 'ObjectExpression') continue;
    for (const p of map.value.properties) {
      const name = p.type === 'ObjectProperty' && !p.computed ? keyOf(p.key) : null;
      if (name && p.type === 'ObjectProperty') out.set(pascal(name), p.value.type === 'Identifier' ? (byLocal.get(p.value.name) ?? null) : null);
    }
  }
  return out;
}

export function templateUsages(file: ParsedFile, imports: ImportBinding[], globals?: ReadonlyMap<string, ImportBinding>): JsxUsage[] {
  const byLocal = new Map(imports.map((i) => [i.local, i]));
  const locals = file.kind === 'vue' ? localComponents(file, byLocal) : new Map<string, ImportBinding | null>();
  const usages = new Map<TemplateElement, JsxUsage>();
  for (const el of file.template?.elements ?? []) {
    let resolved: Resolved;
    if (el.dynamic) resolved = { kind: 'dynamic', expression: el.dynamic };
    else if (!el.component) resolved = { kind: 'intrinsic', element: el.tag };
    else {
      // As in JSX: <Badge> per its import, <DS.Badge> through a namespace import, other dotted tags are components.
      // A Vue tag without an import resolves against the file's own registrations, then global ones, as in Vue.
      const name = pascal(el.tag);
      const parts = name.split('.');
      let imp = byLocal.get(parts[0]!);
      if (!imp && parts.length === 1) imp = locals.has(name) ? (locals.get(name) ?? undefined) : globals?.get(name);
      resolved = !imp?.isDesignSystem
        ? { kind: 'component', name }
        : parts.length === 1
          ? { kind: 'design-system', component: imp.imported === 'default' ? imp.local : imp.imported }
          : parts.length === 2 && imp.imported === '*'
            ? { kind: 'design-system', component: parts[1]! }
            : { kind: 'component', name };
    }
    const attributes = new Map(el.attributes.map((a) => [a.name, a.value as JSXAttribute['value'] | true]));
    usages.set(el, { resolved, line: el.line, endLine: el.endLine, attributes, hasSpread: el.spread, parent: el.parent && usages.get(el.parent) });
  }
  return [...usages.values()];
}

/** The component a template file defines: named after the file, spanning the markup. */
export function templateDefinition(file: ParsedFile, usages: JsxUsage[]): ComponentDefinition[] {
  const t = file.template;
  if (!t || !usages.length) return [];
  const dynamic = [
    ...(t.elements.some((e) => e.spread) ? ['spread props'] : []),
    ...(t.elements.some((e) => e.attributes.some((a) => a.name === 'class' && a.value !== true && a.value.type === 'JSXExpressionContainer')) ? ['computed className'] : []),
    ...usages.flatMap((u) => (u.resolved.kind === 'dynamic' ? [`dynamic tag <${u.resolved.expression}>`] : [])),
  ];
  const name = pascal(file.path.replace(/^.*\//, '').replace(/\.\w+$/, ''));
  return [{ name, line: t.line, endLine: t.endLine, usages, dynamic: [...new Set(dynamic)] }];
}
