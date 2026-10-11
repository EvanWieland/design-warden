import path from 'node:path';
import type { JSXAttribute, JSXOpeningElement, Node } from '@babel/types';
import { lineOf, walk, type ParsedFile } from './parse.ts';
import { pascal, templateDefinition, templateUsages } from './templates.ts';

export interface ImportBinding {
  local: string;
  imported: string; // "default" or "*" for default/namespace imports
  source: string;
  isDesignSystem: boolean;
}

export type Resolved =
  | { kind: 'design-system'; component: string }
  | { kind: 'intrinsic'; element: string }
  | { kind: 'component'; name: string } // imported from elsewhere or defined locally
  | { kind: 'dynamic'; expression: string }; // e.g. <Tag> where Tag is computed at runtime

export interface JsxUsage {
  resolved: Resolved;
  line: number;
  endLine: number;
  /** Attribute name -> value node, or true for shorthand boolean attributes. */
  attributes: Map<string, JSXAttribute['value'] | true>;
  hasSpread: boolean;
  /** The JSX element this one is nested in (through expressions too), for tree shape. */
  parent?: JsxUsage;
}

export interface ComponentDefinition {
  name: string;
  line: number;
  endLine: number;
  usages: JsxUsage[];
  /** Constructs that hide structure or styling from static analysis. */
  dynamic: string[];
}

export type DsMatcher = (fromFile: string, specifier: string) => boolean;

/** Import specifiers count as design-system imports when they match a package name or resolve into a design-system path. */
export function makeDsMatcher(importSources: readonly string[]): DsMatcher {
  const under = (p: string) => importSources.some((s) => p === s || p.startsWith(`${s}/`));
  return (fromFile, spec) =>
    spec.startsWith('.') ? under(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))) : under(spec);
}

export function importsOf(file: ParsedFile, isDs: DsMatcher): ImportBinding[] {
  if (!file.ast) return [];
  const out: ImportBinding[] = [];
  for (const stmt of file.ast.program.body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.importKind === 'type') continue;
    const source = stmt.source.value;
    const isDesignSystem = isDs(file.path, source);
    for (const s of stmt.specifiers) {
      const imported =
        s.type === 'ImportSpecifier' ? (s.imported.type === 'Identifier' ? s.imported.name : s.imported.value) : s.type === 'ImportDefaultSpecifier' ? 'default' : '*';
      out.push({ local: s.local.name, imported, source, isDesignSystem });
    }
  }
  return out;
}

/**
 * Vue components registered globally, by PascalCase name: `app.component('DsButton', DsButton)`,
 * `Vue.component(…)` and chained `createApp(App).component(…)`. Only a registration of an imported
 * component counts, and maps to that import; plugins (`app.use(…)`) are not read.
 */
export function globalComponents(file: ParsedFile, imports: ImportBinding[]): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>();
  if (!file.ast || file.template) return out;
  const byLocal = new Map(imports.map((i) => [i.local, i]));
  walk(file.ast.program, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.property.type !== 'Identifier' || n.callee.property.name !== 'component') return;
    const [name, comp] = n.arguments;
    if (n.arguments.length !== 2 || name?.type !== 'StringLiteral' || comp?.type !== 'Identifier') return;
    const binding = byLocal.get(comp.name);
    if (binding) out.set(pascal(name.value), binding);
  });
  return out;
}

const isPascal = (s: string) => /^[A-Z]/.test(s);

/** Every JSX opening element in the file, resolved to what it renders. Vue templates also resolve against global registrations. */
export function jsxUsages(file: ParsedFile, imports: ImportBinding[], globals?: ReadonlyMap<string, ImportBinding>): JsxUsage[] {
  if (file.template) return templateUsages(file, imports, file.kind === 'vue' ? globals : undefined);
  if (!file.ast) return [];
  const byLocal = new Map(imports.map((i) => [i.local, i]));
  const definedHere = new Set(componentNames(file));
  const out: JsxUsage[] = [];
  const byElement = new Map<Node, JsxUsage>();
  walk(file.ast.program, (node, ancestors) => {
    if (node.type !== 'JSXOpeningElement') return;
    const parent = ancestors[ancestors.length - 1];
    let enclosing: JsxUsage | undefined;
    for (let i = ancestors.length - 2; i >= 0 && !enclosing; i--) enclosing = byElement.get(ancestors[i]!);
    const attributes = new Map<string, JSXAttribute['value'] | true>();
    let hasSpread = false;
    for (const a of node.attributes) {
      if (a.type === 'JSXSpreadAttribute') hasSpread = true;
      else if (a.name.type === 'JSXIdentifier') attributes.set(a.name.name, a.value ?? true);
    }
    out.push({
      resolved: resolveTag(node, byLocal, definedHere, file),
      line: lineOf(node),
      endLine: parent?.loc?.end.line ?? lineOf(node),
      attributes,
      hasSpread,
      parent: enclosing,
    });
    if (parent) byElement.set(parent, out[out.length - 1]!);
  });
  return out;
}

function resolveTag(node: JSXOpeningElement, byLocal: Map<string, ImportBinding>, definedHere: Set<string>, file: ParsedFile): Resolved {
  const n = node.name;
  if (n.type === 'JSXIdentifier') {
    if (!isPascal(n.name)) return { kind: 'intrinsic', element: n.name };
    const imp = byLocal.get(n.name);
    if (imp?.isDesignSystem) return { kind: 'design-system', component: imp.imported === 'default' ? n.name : imp.imported };
    if (imp || definedHere.has(n.name)) return { kind: 'component', name: n.name };
    return { kind: 'dynamic', expression: n.name };
  }
  if (n.type === 'JSXMemberExpression' && n.object.type === 'JSXIdentifier') {
    const imp = byLocal.get(n.object.name);
    if (imp?.isDesignSystem && imp.imported === '*') return { kind: 'design-system', component: n.property.name };
    return { kind: 'component', name: `${n.object.name}.${n.property.name}` };
  }
  return { kind: 'dynamic', expression: file.text.slice(n.start ?? 0, n.end ?? 0) };
}

/** PascalCase top-level functions that render JSX: declarations, arrow functions and memo/forwardRef wrappers. */
export function componentDefinitions(file: ParsedFile, usages: JsxUsage[]): ComponentDefinition[] {
  if (file.template) return templateDefinition(file, usages);
  if (!file.ast) return [];
  const defs: ComponentDefinition[] = [];
  for (const { name, node } of topLevelFunctions(file)) {
    const [line, endLine] = [lineOf(node), node.loc?.end.line ?? lineOf(node)];
    const inside = usages.filter((u) => u.line >= line && u.line <= endLine);
    if (!inside.length) continue;
    const dynamic: string[] = [];
    walk(node, (n) => {
      if (n.type === 'JSXSpreadAttribute') dynamic.push('spread props');
      if (n.type === 'CallExpression' && /createElement$/.test(file.text.slice(n.callee.start ?? 0, n.callee.end ?? 0))) dynamic.push('createElement');
      if (n.type === 'JSXAttribute' && n.name.type === 'JSXIdentifier' && n.name.name === 'className' && n.value?.type === 'JSXExpressionContainer' && n.value.expression.type !== 'StringLiteral') {
        dynamic.push('computed className');
      }
    });
    for (const u of inside) if (u.resolved.kind === 'dynamic') dynamic.push(`dynamic tag <${u.resolved.expression}>`);
    defs.push({ name, line, endLine, usages: inside, dynamic: [...new Set(dynamic)] });
  }
  return defs;
}

function componentNames(file: ParsedFile): string[] {
  return topLevelFunctions(file).map((f) => f.name);
}

function topLevelFunctions(file: ParsedFile): { name: string; node: Node }[] {
  const out: { name: string; node: Node }[] = [];
  const fnLike = (n: Node | null | undefined): Node | null => {
    if (!n) return null;
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') return n;
    // memo(...), forwardRef(...), React.memo(...)
    if (n.type === 'CallExpression') return fnLike(n.arguments[0] as Node | undefined);
    if (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') return fnLike(n.expression);
    return null;
  };
  for (const stmt of file.ast?.program.body ?? []) {
    const decl = stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' ? stmt.declaration : stmt;
    if (!decl) continue;
    if (decl.type === 'FunctionDeclaration' && decl.id && isPascal(decl.id.name)) out.push({ name: decl.id.name, node: decl });
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const fn = fnLike(d.init);
        if (fn && d.id.type === 'Identifier' && isPascal(d.id.name)) out.push({ name: d.id.name, node: d });
      }
    }
  }
  return out;
}

/** Elements that carry no structural meaning and would make unrelated components look alike. */
const GENERIC = new Set(['div', 'span', 'p', 'br', 'strong', 'em', 'b', 'i', 'small']);

export function features(usages: JsxUsage[]): Set<string> {
  const out = new Set<string>();
  for (const { resolved: r } of usages) {
    if (r.kind === 'design-system') out.add(`ds:${r.component}`);
    else if (r.kind === 'component') out.add(`component:${r.name}`);
    else if (r.kind === 'intrinsic' && !GENERIC.has(r.element)) out.add(`html:${r.element}`);
  }
  return out;
}

// ---- tree shape (second provenance signal) ---------------------------------

export interface Tree {
  label: string;
  children: Tree[];
}

const label = (r: Resolved) =>
  r.kind === 'design-system' ? `ds:${r.component}` : r.kind === 'component' ? `component:${r.name}` : r.kind === 'intrinsic' ? `html:${r.element}` : 'dynamic';
const isGeneric = (u: JsxUsage) => u.resolved.kind === 'intrinsic' && GENERIC.has(u.resolved.element);

/**
 * The nesting of the given elements as an ordered tree, normalized like `features()`: generic
 * elements are dropped (their children move up), and adjacent identical subtrees count once, so a
 * wrapper div or one more row of the same kind is not a change of shape.
 */
export function shapeTree(usages: JsxUsage[]): Tree {
  const root: Tree = { label: '', children: [] };
  const inSet = new Set(usages);
  const nodes = new Map<JsxUsage, Tree>();
  for (const u of usages) {
    if (isGeneric(u)) continue;
    let p = u.parent;
    while (p && (!inSet.has(p) || isGeneric(p))) p = p.parent;
    const node: Tree = { label: label(u.resolved), children: [] };
    nodes.set(u, node);
    (p ? nodes.get(p)! : root).children.push(node);
  }
  const key = (t: Tree): string => `${t.label}(${t.children.map(key).join(',')})`;
  const collapse = (t: Tree): Tree => {
    const children = t.children.map(collapse).filter((c, i, all) => i === 0 || key(c) !== key(all[i - 1]!));
    return { label: t.label, children };
  };
  return collapse(root);
}

/** Zhang-Shasha tree edit distance with unit costs for insert, delete and relabel. */
export function treeEditDistance(a: Tree, b: Tree): number {
  const post = (t: Tree) => {
    const nodes: { label: string; leftmost: number }[] = [];
    const visit = (n: Tree): number => {
      let leftmost = -1;
      for (const c of n.children) {
        const i = visit(c);
        if (leftmost < 0) leftmost = nodes[i]!.leftmost;
      }
      nodes.push({ label: n.label, leftmost: leftmost < 0 ? nodes.length : leftmost });
      return nodes.length - 1;
    };
    visit(t);
    return nodes;
  };
  const [A, B] = [post(a), post(b)];
  const keyroots = (ns: typeof A) => [...new Map(ns.map((n, i) => [n.leftmost, i])).values()].sort((x, y) => x - y);
  const td = A.map(() => new Array<number>(B.length).fill(0));
  for (const i of keyroots(A)) {
    for (const j of keyroots(B)) {
      const [li, lj] = [A[i]!.leftmost, B[j]!.leftmost];
      const fd = Array.from({ length: i - li + 2 }, () => new Array<number>(j - lj + 2).fill(0));
      for (let x = 1; x <= i - li + 1; x++) fd[x]![0] = x;
      for (let y = 1; y <= j - lj + 1; y++) fd[0]![y] = y;
      for (let x = li; x <= i; x++) {
        for (let y = lj; y <= j; y++) {
          const [dx, dy] = [x - li + 1, y - lj + 1];
          const edit = Math.min(fd[dx - 1]![dy]! + 1, fd[dx]![dy - 1]! + 1);
          if (A[x]!.leftmost === li && B[y]!.leftmost === lj) {
            fd[dx]![dy] = Math.min(edit, fd[dx - 1]![dy - 1]! + (A[x]!.label === B[y]!.label ? 0 : 1));
            td[x]![y] = fd[dx]![dy]!;
          } else {
            fd[dx]![dy] = Math.min(edit, fd[A[x]!.leftmost - li]![B[y]!.leftmost - lj]! + td[x]![y]!);
          }
        }
      }
    }
  }
  return td[A.length - 1]![B.length - 1]!;
}

/** 1 for identical shapes, falling with the edits needed relative to the larger tree (roots excluded). */
/** 1 when either tree has more than 300 nodes: the shape is then not compared, so it cannot lower composition. */
export function treeSimilarity(a: Tree, b: Tree): number {
  const size = (t: Tree): number => t.children.reduce((n, c) => n + 1 + size(c), 0);
  const larger = Math.max(size(a), size(b));
  // ponytail: Zhang-Shasha needs (n+1)(m+1) memory and more than n·m time, so huge (often generated) components skip it; use an approximate tree distance if their layout changes matter.
  if (larger > 300) return 1;
  return larger === 0 ? 1 : 1 - treeEditDistance(a, b) / larger;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
