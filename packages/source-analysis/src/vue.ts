// Vue single-file components (@vue/compiler-dom in SFC mode) as template parts (templates.ts).
import { createRequire } from 'node:module';
import type { parse as ParseSfc } from '@vue/compiler-dom';
import { container, expressionNode, identifierNode, keepRanges, positions, stringNode, styleBlock, type ParsedTemplate, type TemplateElement } from './templates.ts';

// compiler-dom node and element types used here.
const ELEMENT = 1;
const COMMENT = 3;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;
const TAG_COMPONENT = 1;

interface VNode {
  type: number;
  loc: { start: { offset: number; line: number }; end: { offset: number; line: number } };
}
interface VText extends VNode {
  content: string;
}
interface VProp extends VNode {
  name: string;
  value?: VText; // attributes; the location includes the quotes
  arg?: { content: string; isStatic: boolean; loc: VNode['loc'] }; // directives
  exp?: VText;
}
interface VElement extends VNode {
  tag: string;
  tagType: number;
  props: VProp[];
  children: VNode[];
}

// Loaded on first use (CommonJS build), so runs without .vue files do not pay for the compiler.
let parseSfc: typeof ParseSfc | undefined;

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Splits a .vue file. Throws on template syntax errors and on style languages other than CSS and
 * SCSS, which then make the file unparseable (reported for review) instead of passing unread.
 */
export function parseVue(text: string): ParsedTemplate {
  parseSfc ??= (createRequire(import.meta.url)('@vue/compiler-dom') as { parse: typeof ParseSfc }).parse;
  const errors: string[] = [];
  const root = parseSfc(text, { parseMode: 'sfc', comments: true, onError: (e: Error) => errors.push(e.message) }) as unknown as { children: VNode[] };
  if (errors.length) throw new Error(errors[0]);
  const pos = positions(text);
  const blocks = root.children.filter((n): n is VElement => n.type === ELEMENT);
  const attr = (b: VElement, name: string) => b.props.find((p) => p.type === ATTRIBUTE && p.name === name);
  const lang = (b: VElement) => attr(b, 'lang')?.value?.content ?? '';
  // Markup in another language or in another file would otherwise pass unread. Custom blocks are never read.
  for (const b of blocks) {
    if (['template', 'script', 'style'].includes(b.tag) && attr(b, 'src')) throw new Error(`<${b.tag} src> is not supported (only inline blocks are read)`);
    if (b.tag === 'template' && lang(b) && lang(b) !== 'html') throw new Error(`<template lang="${lang(b)}"> is not supported (HTML is)`);
  }
  const content = (b: VElement): [number, number][] => (b.children[0] ? [[b.children[0].loc.start.offset, b.children[0].loc.end.offset]] : []);
  const scripts = blocks.filter((b) => b.tag === 'script');
  const comments: ParsedTemplate['comments'] = [];
  const styles = blocks.filter((b) => b.tag === 'style').flatMap((b) => content(b).map(([s, e]) => styleBlock(text, pos, s, e, lang(b), comments)));
  const template = blocks.find((b) => b.tag === 'template');
  const elements: TemplateElement[] = [];
  const visit = (n: VNode, parent: TemplateElement | undefined) => {
    if (n.type === COMMENT) comments.push({ text: (n as VText).content, line: n.loc.end.line });
    if (n.type !== ELEMENT) return;
    const el = n as VElement;
    if (el.tag === 'template') {
      for (const c of el.children) visit(c, parent); // <template v-if> wrappers are transparent
      return;
    }
    const component = el.tagType === TAG_COMPONENT;
    const named = (name: string) => (component ? camel(name) : name); // kebab-case attributes are camelCase props on components
    const attributes: TemplateElement['attributes'] = [];
    let spread = false;
    for (const p of el.props) {
      if (p.type === ATTRIBUTE) attributes.push({ name: named(p.name), value: p.value ? stringNode(pos, p.value.content, p.value.loc.start.offset, p.value.loc.end.offset) : true });
      else if (p.type === DIRECTIVE && (p.name === 'bind' || p.name === 'model')) {
        const name = p.arg ? (p.arg.isStatic ? p.arg.content : null) : p.name === 'model' ? 'modelValue' : null;
        if (name && p.exp) attributes.push({ name: named(name), value: container(expressionNode(text, pos, p.exp.loc.start.offset, p.exp.loc.end.offset)) });
        // Same-name shorthand (Vue 3.4): :tone is :tone="tone".
        else if (name && p.arg) attributes.push({ name: named(name), value: container(identifierNode(pos, camel(name), p.arg.loc.start.offset, p.arg.loc.end.offset)) });
        else if (p.name === 'bind' && p.exp) spread = true; // v-bind="object"
      }
    }
    const runtimeTag = el.tag === 'component' && attributes.some((a) => a.name === 'is');
    const e: TemplateElement = { tag: el.tag, component, ...(runtimeTag && { dynamic: 'component' }), line: el.loc.start.line, endLine: el.loc.end.line, attributes, spread, parent };
    elements.push(e);
    for (const c of el.children) visit(c, e);
  };
  for (const c of template?.children ?? []) visit(c, undefined);
  return {
    parts: { line: template?.loc.start.line ?? 1, endLine: template?.loc.end.line ?? 1, elements, styles },
    script: keepRanges(text, scripts.flatMap(content)),
    scriptJsx: scripts.some((b) => /x$/.test(lang(b))),
    comments,
  };
}
