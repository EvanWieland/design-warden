import type { Identifier, MemberExpression, Node, ObjectExpression, TemplateLiteral } from '@babel/types';
import postcss, { type Root } from 'postcss';
import scss from 'postcss-scss';
import valueParser from 'postcss-value-parser';
import { lineOf, walk, type ParsedFile } from './parse.ts';
import { arbitraryValue, themeColor } from './tailwind.ts';
import { positions, type PositionOf } from './templates.ts';

/** One place where a style value is set: a CSS declaration, a JSX style property, a color-like JSX prop or a Tailwind arbitrary value. */
export interface StyleValue {
  property: string; // kebab-case for styles; the prop name for JSX props
  /** Literal value, or null when computed at runtime (then `expression` describes it). */
  value: string | number | null;
  expression?: string;
  line: number;
  column: number;
  /** Last line of a multi-line value, so an edit to any of its lines keeps findings in the change scope. */
  endLine: number;
  source: 'css' | 'css-in-js' | 'jsx-style' | 'jsx-prop' | 'jsx-class';
  /** For `jsx-class`: the class the value came from, such as `md:p-[13px]`. */
  className?: string;
  /** For `jsx-class`: the Tailwind utility of a default-palette class (`bg-red-500` in `hover:bg-red-500/50`); the value is `var(--color-red-500)`. */
  theme?: string;
  /** True for custom-property definitions such as `--local-gap: 4px`. */
  definesCustomProperty: boolean;
  /** Styles that cannot be read at all: an object built elsewhere, CSS that does not parse, a Sass mixin. */
  wholeObject?: boolean;
  /** For `wholeObject`: what cannot be read and why, as the start of the finding's message. */
  lead?: string;
  /** CSS declaration marked `!important`. PostCSS keeps the flag out of `value`, and never sets it for comments or strings. */
  important?: boolean;
}

const COLOR_PROP = /colou?r|fill|stroke|background/i;

/** A Sass value that depends on a `$variable` or `#{}` interpolation, which only the Sass compiler resolves. */
function sassDynamic(value: string): boolean {
  let dynamic = false;
  valueParser(value).walk((n) => {
    if (n.type === 'word' && (n.value.includes('$') || n.value.includes('#{'))) dynamic = true;
  });
  return dynamic;
}

const positionsOf = new WeakMap<ParsedFile, PositionOf>();
/** Line (1-based) and column (0-based) of a file offset; the line table is built once per file. */
const offsetPosition = (file: ParsedFile): PositionOf => {
  let p = positionsOf.get(file);
  if (!p) positionsOf.set(file, (p = positions(file.text)));
  return p;
};

export function styleValues(file: ParsedFile): StyleValue[] {
  if (file.css) return declarationValues(file.css, { file, origin: 0, sass: file.path.endsWith('.scss'), source: 'css' });
  if (!file.ast) return [];
  const out: StyleValue[] = [];
  const objects = localObjects(file);
  const strings = localStrings(file);
  const seen = new Set<Node>();
  const fromObject = (obj: ObjectExpression, kind: ObjectKind = INLINE) => {
    if (seen.has(obj)) return; // a style constant used twice is reported once, where it is defined
    seen.add(obj);
    out.push(...objectStyles(file, obj, objects, fromObject, kind));
  };
  /** Style objects an expression can produce: literals, same-file constants and lookups into them, arrays, and what a function returns. */
  const objectsOf = (n: Node, kind: ObjectKind): void => {
    for (const b of branches(n)) {
      if (b.type === 'ObjectExpression') {
        fromObject(b, kind);
      } else if (b.type === 'Identifier' && objects.has(b.name)) {
        fromObject(objects.get(b.name)!, kind);
      } else if (isLookup(b, objects)) {
        for (const v of lookupValues(b, objects)) objectsOf(v, kind); // styles.root, variants[tone]: read where the map is written
      } else if (b.type === 'ArrayExpression') {
        for (const e of b.elements) if (e && e.type !== 'SpreadElement') objectsOf(e, kind);
      } else {
        for (const r of returnedValues(b)) objectsOf(r, kind);
      }
    }
  };
  const classes = (n: Node) => out.push(...classValues(n, strings, objects, seen));
  /** Class strings in cva() and tv() definitions: the base, slots, variant options and compound variants' class; not variant names or defaults. */
  const variantClasses = (args: Node[]) => {
    for (const arg of args) {
      const a = unwrap(arg);
      if (a.type !== 'ObjectExpression') {
        classes(a); // cva's first argument: the base classes
        continue;
      }
      for (const [key, v] of entries(a)) {
        if (key === 'base' || key === 'class' || key === 'className') classes(v);
        else if (key === 'slots') for (const [, s] of entriesOf(v)) classes(s);
        else if (key === 'variants') for (const [, variant] of entriesOf(v)) for (const [, option] of entriesOf(variant)) for (const c of option.type === 'ObjectExpression' ? entries(option).map(([, x]) => x) : [option]) classes(c);
        else if (key === 'compoundVariants' || key === 'compoundSlots') {
          for (const item of v.type === 'ArrayExpression' ? v.elements : []) for (const [k2, c] of item?.type === 'ObjectExpression' ? entries(item) : []) if (k2 === 'class' || k2 === 'className') classes(c);
        }
      }
    }
  };
  /** One attribute of a JSX element or a template element (string literal or expression container). */
  const attribute = (name: string, value: Node | null | undefined) => {
    if (!value) return;
    const expr = value.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression' ? unwrap(value.expression) : null;
    if (name === 'className' || name === 'class' || /ClassName$/.test(name)) {
      classes(expr ?? value); // also component props such as labelClassName
    } else if (name === 'style' && value.type === 'StringLiteral') {
      out.push(...inlineCss(file, value)); // style="color: red" (Vue, Svelte, Preact, Solid)
    } else if (name === 'style' && expr?.type === 'TemplateLiteral') {
      // style="color: red; padding: {gap}px" (Svelte), :style="`…${x}…`" (Vue): read the static declarations.
      out.push(...templateCss(file, expr, 'jsx-style', { lead: `Inline style \`${source(file, expr)}\` could not be parsed as CSS`, offset: expr.start ?? 0 }, postcss));
    } else if (name === 'style' && expr) {
      // A lookup is read only when every value it can return is a style object written here (an empty map is filled elsewhere).
      const known = (v: Node) => v.type === 'ObjectExpression' || (v.type === 'Identifier' && objects.has(v.name));
      const resolved = isLookup(expr, objects) && lookupValues(expr, objects).length > 0 && lookupValues(expr, objects).every(known);
      if (known(expr) || resolved) objectsOf(expr, INLINE);
      else out.push(at(expr, { property: 'style', value: null, expression: source(file, expr), source: 'jsx-style', definesCustomProperty: false, wholeObject: true }));
    } else if ((name === 'css' || name === 'sx') && expr) {
      // Emotion's css prop and MUI's sx prop. css={css`…`} and css={css({…})} are read as the template or call they are.
      objectsOf(expr, name === 'sx' ? SX : CSS_IN_JS);
    } else if (COLOR_PROP.test(name)) {
      // Color-like props on any element or component, e.g. <Icon color="#fff" /> or fill={on ? '#000' : 'none'}.
      // Only literal values are judged: passing a variable (often a token) through a prop is normal.
      for (const c of expr ? branches(expr) : [value]) {
        const lit = literalOf(c);
        if (lit !== undefined && lit !== null) out.push(at(c, { property: name, value: lit, source: 'jsx-prop', definesCustomProperty: false }));
      }
    }
  };
  walk(file.ast.program, (node) => {
    if (node.type === 'TaggedTemplateExpression' && isStyleTag(node.tag)) {
      out.push(...templateCss(file, node.quasi, 'css-in-js', { lead: `The \`${source(file, node.tag)}\` template could not be parsed as CSS`, offset: node.start ?? 0 }, scss));
      return;
    }
    // Object styles: css({…}), styled.div({…}), styled(Button)((p) => ({…})), keyframes({…}).
    if (node.type === 'CallExpression' && isStyleTag(node.callee)) for (const arg of node.arguments) objectsOf(arg as Node, CSS_IN_JS);
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && CLASS_HELPERS.has(node.callee.name)) {
      for (const arg of node.arguments) classes(arg as Node);
      return;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && (node.callee.name === 'cva' || node.callee.name === 'tv')) {
      variantClasses(node.arguments as Node[]);
      return;
    }
    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier') attribute(node.name.name, node.value);
  });
  if (file.template) {
    for (const el of file.template.elements) for (const a of el.attributes) if (a.value !== true) attribute(a.name, a.value);
    for (const s of file.template.styles) out.push(...declarationValues(s.root, { file, origin: s.origin, sass: s.sass, source: 'css' }));
  }
  return out;
}

/** A stylesheet rule, for naming where an element's styles come from. */
export interface StyleRule {
  file: string;
  line: number;
  selector: string;
}

/** The rules of every stylesheet and component style block, by each class their selector uses, sorted by file and line. */
export function indexClasses(files: Iterable<ParsedFile>): Map<string, StyleRule[]> {
  const index = new Map<string, StyleRule[]>();
  const add = (file: ParsedFile, root: Root, origin: number) => {
    const pos = offsetPosition(file);
    root.walkRules((r) => {
      const rule = { file: file.path, line: pos(origin + (r.source?.start?.offset ?? 0)).line, selector: brief(r.selector) };
      // Attribute values (a[href$=".pdf"]) and negated classes (:not(.is-active)) are not classes the rule styles.
      const plain = r.selector.replace(/\[[^\]]*\]/g, '').replace(/:not\([^)]*\)/g, '');
      for (const cls of new Set(Array.from(plain.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), (m) => m[1]!))) {
        (index.get(cls) ?? index.set(cls, []).get(cls)!).push(rule);
      }
    });
  };
  for (const f of files) {
    if (f.css) add(f, f.css, 0);
    for (const s of f.template?.styles ?? []) add(f, s.root, s.origin);
  }
  for (const rules of index.values()) rules.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return index;
}

/** Whether a project uses Tailwind: a `tailwindcss` dependency in its package.json, or a stylesheet with `@import "tailwindcss"`, `@tailwind` or `@theme`. */
export function detectTailwind(files: Iterable<ParsedFile>, readPackageJson: () => string): boolean {
  try {
    const pkg = JSON.parse(readPackageJson()) as Record<string, unknown>;
    if (['dependencies', 'devDependencies', 'peerDependencies'].some((k) => typeof pkg[k] === 'object' && pkg[k] !== null && 'tailwindcss' in (pkg[k] as object))) return true;
  } catch {
    // no readable package.json: the stylesheets decide
  }
  for (const f of files) {
    for (const root of [f.css, ...(f.template?.styles ?? []).map((s) => s.root)]) {
      let found = false;
      root?.walkAtRules((a) => {
        if (a.name === 'tailwind' || a.name === 'theme' || (a.name === 'import' && a.params.includes('tailwindcss'))) found = true;
      });
      if (found) return true;
    }
  }
  return false;
}

/** Where a parsed stylesheet sits in the file, and which parts of it stood for `${…}`. */
interface CssContext {
  file: ParsedFile;
  /** File offset of the first character of the parsed text: PostCSS offsets are added to it. */
  origin: number;
  sass: boolean;
  source: StyleValue['source'];
  /** Placeholder ranges (offsets in the parsed text) standing for `${…}`; a declaration touching one is computed. */
  holes?: [number, number][];
}

/**
 * Declarations of every kind of stylesheet: CSS and SCSS files, `<style>` blocks, inline style
 * strings and CSS-in-JS templates. Positions are file positions; `!important` is kept everywhere.
 */
function declarationValues(root: Root, ctx: CssContext): StyleValue[] {
  const pos = offsetPosition(ctx.file);
  const where = (offset: number) => pos(ctx.origin + offset);
  const original = (from: number, to: number) => ctx.file.text.slice(ctx.origin + from, ctx.origin + to);
  const inHole = (a: number, b: number) => (ctx.holes ?? []).some(([s, e]) => s < b && e > a);
  const out: StyleValue[] = [];
  const unreadable = (offset: number, lead: string) => {
    const p = where(offset);
    out.push({ property: 'css', value: null, lead, line: p.line, column: p.column + 1, endLine: p.line, source: ctx.source, definesCustomProperty: false, wholeObject: true });
  };
  root.walkDecls((d) => {
    const start = d.source?.start?.offset ?? 0;
    const from = start + d.prop.length + (d.raws.between?.length ?? 0);
    const to = from + ((d.raws.value as { raw?: string } | undefined)?.raw ?? d.value).length;
    // A property name chosen at runtime (`${prop}: red`) could be any property: ask for review.
    if (inHole(start, start + d.prop.length)) return unreadable(start, `\`${brief(original(start, to))}\` sets a property chosen at runtime`);
    if (ctx.sass && d.prop.includes('#{')) return; // interpolated property name
    const dynamic = inHole(from, to) || (ctx.sass && sassDynamic(d.value));
    if (dynamic && d.prop.startsWith('$')) return; // a variable built from others is judged where it is used
    const p = where(start);
    out.push({
      property: d.prop.startsWith('--') || d.prop.startsWith('$') ? d.prop : d.prop.toLowerCase(),
      ...(dynamic ? { value: null, expression: brief(original(from, to)) } : { value: d.value }),
      line: p.line,
      column: p.column + 1,
      endLine: where(d.source?.end?.offset ?? start).line,
      source: ctx.source,
      definesCustomProperty: d.prop.startsWith('--'),
      important: d.important,
    });
  });
  // A mixin included with arguments sets styles only its definition shows. Without arguments (or with
  // empty parentheses) its declarations are checked where it is defined; a content block is checked here.
  if (ctx.sass) {
    root.walkAtRules('include', (a) => {
      if (a.nodes || !/\(\s*[^)\s]/.test(a.params)) return;
      unreadable(a.source?.start?.offset ?? 0, `\`${brief(`@include ${a.params}`)}\` includes a mixin whose styles cannot be read`);
    });
  }
  return out;
}

/** CSS text at `origin` in the file: its declarations, or one review request if it does not parse. */
function cssText(file: ParsedFile, css: string, ctx: Omit<CssContext, 'file' | 'sass'>, failure: { lead: string; offset: number }, parser: { parse(css: string): Root }): StyleValue[] {
  try {
    return declarationValues(parser.parse(css), { ...ctx, file, sass: false });
  } catch {
    const p = offsetPosition(file)(failure.offset);
    return [{ property: 'css', value: null, lead: failure.lead, line: p.line, column: p.column + 1, endLine: p.line, source: ctx.source, definesCustomProperty: false, wholeObject: true }];
  }
}

/** A static style="…" string. Unparseable CSS is reported for review: a browser may still apply part of it. */
function inlineCss(file: ParsedFile, lit: Node): StyleValue[] {
  if (lit.start == null || lit.end == null) return [];
  const quoted = /["'`]/.test(file.text[lit.start] ?? '');
  const [from, to] = quoted ? [lit.start + 1, lit.end - 1] : [lit.start, lit.end];
  const text = file.text.slice(from, to);
  return cssText(file, text, { origin: from, source: 'jsx-style' }, { lead: `Inline style \`${brief(text)}\` could not be parsed as CSS`, offset: from }, postcss);
}

/**
 * Declarations of CSS written as a template literal (CSS-in-JS, or an inline style built with `${…}`).
 * Each `${…}` becomes a placeholder of the same length, so positions map back to the file exactly:
 * a comment where it stands alone as a statement (a mixin), a word anywhere else (selector, value).
 */
function templateCss(file: ParsedFile, tl: TemplateLiteral, kind: StyleValue['source'], failure: { lead: string; offset: number }, parser: { parse(css: string): Root }): StyleValue[] {
  const { quasis } = tl;
  const holes: [number, number][] = [];
  let css = '';
  quasis.forEach((q, i) => {
    css += file.text.slice(q.start!, q.end!);
    const next = quasis[i + 1];
    if (!next) return;
    const hole = file.text.slice(q.end!, next.start!); // `${…}`
    const statementEnd = /^[ \t]*($|[\r\n;}]|\/\/|\/\*)/.test(file.text.slice(next.start!, next.end!));
    holes.push([css.length, css.length + hole.length]);
    css += statementStart(css) && statementEnd ? `/*${hole.slice(2, -2).replace(/[^\n]/g, ' ')}*/` : hole.replace(/[^\n]/g, '_');
  });
  return cssText(file, css, { origin: quasis[0]!.start!, source: kind, holes }, failure, parser);
}

/** Whether a statement can start at the end of `css`: only whitespace and comments (mixin placeholders too) since `{`, `;`, `}` or the start. */
function statementStart(css: string): boolean {
  let i = css.length;
  for (;;) {
    while (i > 0 && /\s/.test(css[i - 1]!)) i--;
    if (i >= 2 && css[i - 1] === '/' && css[i - 2] === '*') {
      const open = css.lastIndexOf('/*', i - 3);
      if (open < 0) return false;
      i = open;
      continue;
    }
    const lineStart = css.lastIndexOf('\n', i - 1) + 1;
    const slashes = css.indexOf('//', lineStart);
    if (slashes >= 0 && slashes < i && !/url\(|["']/.test(css.slice(lineStart, slashes))) {
      i = slashes; // a // line comment (stylis allows them)
      continue;
    }
    return i === 0 || '{};'.includes(css[i - 1]!);
  }
}

/** How a style object is read: an inline style, CSS-in-JS (`css({…})`, the `css` prop) or MUI's theme-aware `sx` prop. */
interface ObjectKind {
  source: 'jsx-style' | 'css-in-js';
  sx?: boolean;
}
const INLINE: ObjectKind = { source: 'jsx-style' };
const CSS_IN_JS: ObjectKind = { source: 'css-in-js' };
const SX: ObjectKind = { source: 'css-in-js', sx: true };

/** MUI system shorthands, as the CSS properties they set. */
const SX_ALIASES: Record<string, string> = {
  m: 'margin', mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', mx: 'margin-inline', my: 'margin-block', marginX: 'margin-inline', marginY: 'margin-block',
  p: 'padding', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left', px: 'padding-inline', py: 'padding-block', paddingX: 'padding-inline', paddingY: 'padding-block',
  bgcolor: 'background-color',
};
/** A theme path such as `primary.main` or `grey.500`, which MUI resolves through the theme. */
const THEME_PATH = /^[a-z][\w-]*(\.[\w-]+)+$/i;
/** Characters of a selector or an at-rule key (`&:hover`, `@media …`, `.child`); a breakpoint key (`xs`, `md`) has none. */
const SELECTOR_CHARS = /[&:@.#[\]*>+~\s]/;

/** The written-out properties of an object literal as [key, value] (computed keys and spreads left out). */
function entries(obj: ObjectExpression): [string, Node][] {
  return obj.properties.flatMap((p): [string, Node][] => {
    if (p.type !== 'ObjectProperty' || p.computed) return [];
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
    return key === null ? [] : [[key, unwrap(p.value as Node)]];
  });
}
const entriesOf = (n: Node): [string, Node][] => (n.type === 'ObjectExpression' ? entries(n) : []);

/** `map.key` or `map[key]` on a same-file object constant. */
function isLookup(n: Node, objects: Map<string, ObjectExpression>): n is MemberExpression {
  return n.type === 'MemberExpression' && n.object.type === 'Identifier' && objects.has(n.object.name);
}

/** What a lookup can return: the named entry, or every entry when the key is chosen at runtime. */
function lookupValues(n: MemberExpression, objects: Map<string, ObjectExpression>): Node[] {
  const all = entries(objects.get((n.object as Identifier).name)!);
  const key = !n.computed && n.property.type === 'Identifier' ? n.property.name : n.property.type === 'StringLiteral' ? n.property.value : null;
  return all.filter(([k]) => key === null || k === key).map(([, v]) => v);
}

function objectStyles(file: ParsedFile, obj: ObjectExpression, objects: Map<string, ObjectExpression>, nested: (o: ObjectExpression, kind: ObjectKind) => void, kind: ObjectKind): StyleValue[] {
  const out: StyleValue[] = [];
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') {
      if (kind.sx) continue; // theme-aware props passed through: nothing literal to judge
      const arg = unwrap(p.argument);
      const spread = arg.type === 'ObjectExpression' ? arg : arg.type === 'Identifier' ? objects.get(arg.name) : undefined;
      if (spread) nested(spread, kind);
      else out.push(at(arg, { property: 'style', value: null, expression: `...${source(file, arg)}`, source: kind.source, definesCustomProperty: false, wholeObject: true }));
      continue;
    }
    if (p.type !== 'ObjectProperty') continue;
    const value = unwrap(p.value as Node);
    if (p.computed) {
      // A selector built at runtime ([`&.${classes.head}`]) holds a nested rule; any other computed key sets a property chosen at runtime.
      if (value.type === 'ObjectExpression') nested(value, kind);
      else if (!kind.sx) out.push(at(p.key, { property: 'style', value: null, lead: `\`[${source(file, p.key)}]\` sets a property chosen at runtime`, source: kind.source, definesCustomProperty: false, wholeObject: true }));
      continue;
    }
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
    if (!key) continue;
    // An object is a nested rule (selector, media query, keyframe step), except under an sx property, where it holds breakpoints.
    if (value.type === 'ObjectExpression' && !(kind.sx && !SELECTOR_CHARS.test(key))) {
      nested(value, kind);
      continue;
    }
    const property = key.startsWith('--') ? key : kind.sx && SX_ALIASES[key] ? SX_ALIASES[key] : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    // sx takes responsive arrays (`px: [1, '10px']`) and breakpoint objects (`px: { xs: 1, md: '18px' }`).
    const candidates =
      kind.sx && value.type === 'ArrayExpression'
        ? value.elements.filter((e): e is NonNullable<typeof e> => !!e && e.type !== 'SpreadElement').flatMap((e) => branches(e))
        : kind.sx && value.type === 'ObjectExpression'
          ? entries(value).flatMap(([, v]) => branches(v))
          : branches(value);
    for (const b of candidates) {
      const lit = literalOf(b);
      if (lit === null) continue; // `undefined` / `null` unset the property
      // MUI resolves theme paths, computed values and numbers (`p: 2`) through the theme, except a numeric fontSize, which is pixels.
      if (kind.sx && (typeof lit === 'number' ? property !== 'font-size' : typeof lit !== 'string' || THEME_PATH.test(lit))) continue;
      out.push(
        at(b, {
          property,
          source: kind.source,
          definesCustomProperty: key.startsWith('--'),
          ...(lit !== undefined ? { value: lit } : { value: null, expression: source(file, b) }),
        }),
      );
    }
  }
  return out;
}

/** What a function passed to a style call returns: the concise body, or every `return` of its block (not of nested functions). */
function returnedValues(fn: Node): Node[] {
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return [];
  if (fn.body.type !== 'BlockStatement') return [fn.body];
  const out: Node[] = [];
  const visit = (s: Node | null | undefined): void => {
    if (!s) return;
    if (s.type === 'ReturnStatement' && s.argument) out.push(s.argument);
    else if (s.type === 'BlockStatement') s.body.forEach(visit);
    else if (s.type === 'IfStatement') [s.consequent, s.alternate].forEach(visit);
    else if (s.type === 'SwitchStatement') for (const c of s.cases) c.consequent.forEach(visit);
  };
  visit(fn.body);
  return out;
}

const CSS_TAGS = new Set(['css', 'createGlobalStyle', 'keyframes', 'injectGlobal']);

/** styled-components and Emotion tags: `styled.div`, `styled(Button)`, `styled.div.attrs(…)`, `css`, `createGlobalStyle`, `keyframes`. */
function isStyleTag(tag: Node): boolean {
  if (tag.type === 'Identifier') return CSS_TAGS.has(tag.name);
  if (tag.type === 'MemberExpression') return tag.object.type === 'Identifier' && tag.object.name === 'styled';
  if (tag.type !== 'CallExpression') return false;
  const c = tag.callee;
  if (c.type === 'Identifier') return c.name === 'styled';
  return c.type === 'MemberExpression' && c.property.type === 'Identifier' && (c.property.name === 'attrs' || c.property.name === 'withConfig') && isStyleTag(c.object);
}

const CLASS_HELPERS = new Set(['clsx', 'cn', 'classnames', 'classNames', 'cx', 'twMerge', 'twJoin']);

/** A literal piece of a class string, with the 1-based position of its first character. */
interface ClassPiece {
  text: string;
  line: number;
  column: number;
}

/**
 * Class strings an expression can produce: every literal branch, clsx-style arrays and object keys,
 * the static parts of template literals, and string constants of the same file (read once, where
 * they are defined). A class cut by a `${…}` (`p-[${n}px]`) has unbalanced brackets, so
 * `arbitraryValue` rejects it.
 */
function classPieces(n: Node, strings: Map<string, Node>, objects: Map<string, ObjectExpression>, seen: Set<Node>): ClassPiece[] {
  const pieces = (x: Node) => classPieces(x, strings, objects, seen);
  return branches(n).flatMap((b): ClassPiece[] => {
    if (b.type === 'StringLiteral') return [{ text: b.value, line: lineOf(b), column: (b.loc?.start.column ?? 0) + 2 }];
    if (b.type === 'TemplateLiteral') {
      return [...b.quasis.map((q) => ({ text: q.value.cooked ?? '', line: lineOf(q), column: (q.loc?.start.column ?? 0) + 1 })), ...b.expressions.flatMap((e) => pieces(e as Node))];
    }
    if (b.type === 'Identifier') {
      const init = strings.get(b.name);
      if (!init || seen.has(init)) return [];
      seen.add(init);
      return pieces(init);
    }
    // A lookup into a same-file class map (tones[tone]): its entries, read once where they are written.
    if (isLookup(b, objects)) return lookupValues(b, objects).flatMap((v) => (seen.has(v) ? [] : (seen.add(v), pieces(v))));
    // ['a', on && 'b'].join(' ')
    if (b.type === 'CallExpression' && b.callee.type === 'MemberExpression' && !b.callee.computed && b.callee.property.type === 'Identifier' && b.callee.property.name === 'join' && b.callee.object.type === 'ArrayExpression') return pieces(b.callee.object);
    if (b.type === 'ArrayExpression') return b.elements.flatMap((e) => (e && e.type !== 'SpreadElement' ? pieces(e) : []));
    if (b.type === 'ObjectExpression') return b.properties.flatMap((p) => (p.type === 'ObjectProperty' && p.key.type === 'StringLiteral' ? pieces(p.key) : []));
    return [];
  });
}

/** Tailwind arbitrary values (`p-[13px]`) and default-palette color classes (`bg-red-500`) in class strings, as style values located at their class. */
function classValues(n: Node, strings: Map<string, Node>, objects: Map<string, ObjectExpression>, seen: Set<Node>): StyleValue[] {
  const out: StyleValue[] = [];
  for (const piece of classPieces(n, strings, objects, seen)) {
    // Positions advance with the scan, so a long class string is read in one pass.
    let [line, lastBreak, scanned] = [piece.line, -1, 0];
    for (const m of piece.text.matchAll(/\S+/g)) {
      for (; scanned < m.index; scanned++) if (piece.text.charCodeAt(scanned) === 10) [line, lastBreak] = [line + 1, scanned];
      const v = arbitraryValue(m[0]);
      const t = v ? null : themeColor(m[0]);
      const found = v ?? t;
      if (!found) continue;
      const column = lastBreak < 0 ? piece.column + m.index : m.index - lastBreak;
      out.push({
        property: found.property,
        value: found.value,
        line,
        column,
        endLine: line,
        source: 'jsx-class',
        className: m[0],
        definesCustomProperty: found.property.startsWith('--'),
        ...(t ? { theme: t.utility } : {}),
      });
    }
  }
  return out;
}

/** `const name = { … }` object literals in the file (scope-unaware: the last one wins). */
function localObjects(file: ParsedFile): Map<string, ObjectExpression> {
  // ponytail: no scope analysis; a shadowed name resolves to the last declaration. Upgrade: a scope-aware binding lookup.
  const map = new Map<string, ObjectExpression>();
  walk(file.ast!.program, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) return;
    const init = unwrap(node.init);
    if (init.type === 'ObjectExpression') map.set(node.id.name, init);
  });
  return map;
}

/** `const name = '…'` string and template literals in the file, for class names built from constants (scope-unaware, as above). */
function localStrings(file: ParsedFile): Map<string, Node> {
  const map = new Map<string, Node>();
  walk(file.ast!.program, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) return;
    const init = unwrap(node.init);
    if (init.type === 'StringLiteral' || init.type === 'TemplateLiteral') map.set(node.id.name, init);
  });
  return map;
}

/** Strips wrappers that only exist for the type checker: `x as T`, `x satisfies T`, `x!`, `(x)`. */
export function unwrap(n: Node): Node {
  while (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSNonNullExpression' || n.type === 'TSTypeAssertion' || n.type === 'ParenthesizedExpression') {
    n = n.expression;
  }
  return n;
}

/** The values an expression can take: both arms of `a ? b : c`, both sides of `??` and `||`, the right side of `&&`. */
export function branches(n: Node): Node[] {
  const e = unwrap(n);
  if (e.type === 'ConditionalExpression') return [...branches(e.consequent), ...branches(e.alternate)];
  if (e.type === 'LogicalExpression') return e.operator === '&&' ? branches(e.right) : [...branches(e.left), ...branches(e.right)];
  return [e];
}

/** Value of a string/number literal or an expression-free template literal; undefined otherwise. */
export function literalOf(node: Node): string | number | null | undefined {
  const n = unwrap(node);
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'NumericLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0]?.value.cooked ?? '';
  if (n.type === 'NullLiteral' || (n.type === 'Identifier' && n.name === 'undefined')) return null;
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral') return -n.argument.value;
  return undefined;
}

const source = (file: ParsedFile, node: Node) => brief(node.start != null && node.end != null ? file.text.slice(node.start, node.end) : node.type);

const brief = (s: string) => {
  const one = s.replace(/\s+/g, ' ');
  return one.length > 80 ? `${one.slice(0, 77)}...` : one;
};

function at(node: Node, v: Omit<StyleValue, 'line' | 'column' | 'endLine'>): StyleValue {
  const line = lineOf(node);
  return { ...v, line, column: (node.loc?.start.column ?? 0) + 1, endLine: node.loc?.end.line ?? line };
}
