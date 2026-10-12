// Svelte components (svelte/compiler, modern AST) as template parts (templates.ts).
import type { Node } from '@babel/types';
import { createRequire } from 'node:module';
import type { parse as SvelteParse } from 'svelte/compiler';
import { container, expressionNode, identifierNode, keepRanges, openTagEnd, positions, stringNode, styleBlock, type ParsedTemplate, type PositionOf, type TemplateElement } from './templates.ts';

interface SNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
interface SText extends SNode {
  data: string;
}
interface STag extends SNode {
  expression: SNode;
}
interface SAttr extends SNode {
  name: string;
  value: true | STag | (SText | STag)[];
  expression?: SNode;
}

// Loaded on first use (CommonJS build, ~50 ms instead of ~400 ms for the ESM one), so runs without .svelte files do not pay for it.
let parse: typeof SvelteParse | undefined;

/** Element-like nodes and how their tag resolves; other `svelte:*` elements are transparent. */
const KIND: Record<string, 'intrinsic' | 'component' | 'dynamic'> = {
  RegularElement: 'intrinsic',
  SlotElement: 'intrinsic',
  TitleElement: 'intrinsic',
  Component: 'component',
  SvelteSelf: 'component',
  SvelteElement: 'dynamic',
  SvelteComponent: 'dynamic',
};
/** Where nested markup lives in elements and blocks. */
const FRAGMENTS = ['fragment', 'nodes', 'consequent', 'alternate', 'body', 'pending', 'then', 'catch', 'fallback'];

/**
 * Splits a .svelte file. Throws on syntax errors and on style languages other than CSS and SCSS,
 * which then make the file unparseable (reported for review) instead of passing unread.
 */
export function parseSvelte(text: string): ParsedTemplate {
  parse ??= (createRequire(import.meta.url)('svelte/compiler') as { parse: typeof SvelteParse }).parse;
  const ast = parse(text, { modern: true }) as unknown as { fragment: SNode; instance?: SNode | null; module?: SNode | null; css?: SNode | null };
  const pos = positions(text);
  const lang = (n: SNode) => ((n.attributes as SAttr[]).find((a) => a.name === 'lang')?.value as SText[] | undefined)?.[0]?.data ?? '';
  const content = (n: SNode | null | undefined): [number, number][] => (n ? [[(n.content as SNode).start, (n.content as SNode).end]] : []);
  const scripts = [ast.instance, ast.module].filter((s): s is SNode => Boolean(s));
  // A preprocessed <template lang="pug"> would otherwise pass unread as text.
  const markup = (ast.fragment.nodes as SNode[]).find((n) => n.type === 'RegularElement' && n.name === 'template' && lang(n) && lang(n) !== 'html');
  if (markup) throw new Error(`<template lang="${lang(markup)}"> is not supported (Svelte markup is)`);
  const comments: ParsedTemplate['comments'] = [];
  const styles = content(ast.css).map(([s, e]) => styleBlock(text, pos, s, e, lang(ast.css!), comments));

  const elements: TemplateElement[] = [];
  let markupEnd = 1; // last line of any element, for the span of the component the markup defines
  const visit = (n: SNode, parent: TemplateElement | undefined) => {
    if (n.type === 'Comment') comments.push({ text: (n as SText).data, line: pos(n.end).line });
    const kind = KIND[n.type];
    let e = parent;
    if (kind) {
      const { attributes, spread } = attributesOf(text, pos, n.attributes as SAttr[]);
      // In Svelte 5 a snippet declared inside a component is a prop of that name.
      for (const s of ((n.fragment as SNode | undefined)?.nodes as SNode[] | undefined) ?? []) {
        const id = s.type === 'SnippetBlock' ? (s.expression as SNode & { name?: string }) : undefined;
        if (id?.name) attributes.push({ name: id.name, value: container(identifierNode(pos, id.name, id.start, id.end)) });
      }
      // A component's content can pass props in Svelte 5 (snippets), so a missing prop spans the whole element.
      const tagEnd = openTagEnd(text, (n.attributes as SAttr[]).at(-1)?.end ?? n.start + 1 + String(n.name).length, n.end);
      e = { tag: String(n.name), component: kind === 'component', ...(kind === 'dynamic' && { dynamic: String(n.name) }), line: pos(n.start).line, endLine: pos(tagEnd).line, ...(kind === 'component' && { propsEndLine: pos(n.end).line }), attributes, spread, parent };
      elements.push(e);
      markupEnd = Math.max(markupEnd, pos(n.end).line);
    }
    for (const key of FRAGMENTS) {
      const child = n[key];
      if (Array.isArray(child)) for (const c of child as SNode[]) visit(c, e);
      else if (child && typeof child === 'object' && 'type' in child) visit(child as SNode, e);
    }
  };
  visit(ast.fragment, undefined);
  return {
    parts: { line: elements[0]?.line ?? 1, endLine: markupEnd, elements, styles },
    script: keepRanges(text, scripts.flatMap(content)),
    scriptJsx: false,
    comments,
  };
}

function attributesOf(text: string, pos: PositionOf, attrs: SAttr[]): Pick<TemplateElement, 'attributes' | 'spread'> {
  const attributes: TemplateElement['attributes'] = [];
  let spread = false;
  const expr = (n: SNode) => expressionNode(text, pos, n.start, n.end);
  for (const a of attrs) {
    if (a.type === 'Attribute') attributes.push({ name: a.name, value: valueOf(text, pos, a.value) });
    else if (a.type === 'SpreadAttribute') spread = true;
    else if (a.type === 'BindDirective' && a.expression) attributes.push({ name: a.name, value: container(expr(a.expression)) }); // bind:open={o} sets the prop
    else if (a.type === 'ClassDirective') {
      // class:text-[#e11d48]={on} is the class `text-[#e11d48]`; located as if quoted, like an attribute value.
      const at = a.start + 'class:'.length;
      attributes.push({ name: 'class', value: stringNode(pos, a.name, at - 1, at + a.name.length + 1) });
    } else if (a.type === 'StyleDirective') {
      // style:padding={gap} is the inline style { padding: gap }.
      const value = a.value === true ? expressionNode(text, pos, a.start + 'style:'.length, a.start + 'style:'.length + a.name.length) : valueOf(text, pos, a.value);
      const v = value !== true && value.type === 'JSXExpressionContainer' ? (value as unknown as { expression: Node }).expression : value;
      const key = { type: 'Identifier', name: a.name, start: a.start, end: a.start + a.name.length, loc: { start: pos(a.start), end: pos(a.end) } };
      attributes.push({ name: 'style', value: container({ type: 'ObjectExpression', properties: [{ type: 'ObjectProperty', key, value: v, computed: false }] } as unknown as Node) });
    }
  }
  return { attributes, spread };
}

/** An attribute value: true, a string literal (quotes included in its location), an expression, or text with expressions as a template literal. */
function valueOf(text: string, pos: PositionOf, value: SAttr['value']): Node | true {
  if (value === true) return true;
  const parts = Array.isArray(value) ? value : [value];
  if (parts.length === 1 && parts[0]!.type === 'Text') {
    const t = parts[0] as SText;
    const quoted = /["']/.test(text[t.start - 1] ?? '') && text[t.end] === text[t.start - 1];
    return stringNode(pos, t.data, quoted ? t.start - 1 : t.start, quoted ? t.end + 1 : t.end);
  }
  if (parts.length === 1) return container(expressionNode(text, pos, (parts[0] as STag).expression.start, (parts[0] as STag).expression.end));
  const quasis: object[] = [];
  const expressions: Node[] = [];
  let pending: SText | null = null;
  const quasi = (t: SText | null, at: number) => ({ type: 'TemplateElement', value: { raw: t?.data ?? '', cooked: t?.data ?? '' }, tail: false, start: t?.start ?? at, end: t?.end ?? at, loc: { start: pos(t?.start ?? at), end: pos(t?.end ?? at) } });
  for (const p of parts) {
    if (p.type === 'Text') pending = p as SText;
    else {
      quasis.push(quasi(pending, p.start));
      pending = null;
      expressions.push(expressionNode(text, pos, (p as STag).expression.start, (p as STag).expression.end));
    }
  }
  quasis.push(quasi(pending, parts[parts.length - 1]!.end));
  const [start, end] = [parts[0]!.start, parts[parts.length - 1]!.end];
  return container({ type: 'TemplateLiteral', quasis, expressions, start, end, loc: { start: pos(start), end: pos(end) } } as unknown as Node);
}
