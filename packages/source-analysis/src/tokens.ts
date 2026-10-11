import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

export interface TokenDef {
  name: string;
  value: string;
  file: string;
  line: number;
  /** DTCG `$deprecated`: true, or the reason. */
  deprecated?: true | string;
}

export interface TokenSet {
  defs: Map<string, TokenDef>;
  isAllowed(name: string): boolean;
  /** Allowed and not deprecated: the tokens a suggestion may name. */
  canSuggest(name: string): boolean;
  /** Follows var() references to a literal value; null for unknown or cyclic tokens. */
  resolve(name: string): string | null;
}

/** Token definitions of a token source: CSS custom properties, or a DTCG `*.tokens.json` file. */
export const readTokenDefs = (file: string, text: string): TokenDef[] => (/\.json$/i.test(file) ? parseDtcgTokens(file, text) : parseTokenDefs(file, text));

/** Custom-property definitions in a token source file. The first definition of a name wins (default theme). */
export function parseTokenDefs(file: string, css: string): TokenDef[] {
  const defs: TokenDef[] = [];
  postcss.parse(css, { from: file }).walkDecls(/^--/, (d) => {
    defs.push({ name: d.prop, value: d.value.trim(), file, line: d.source?.start?.line ?? 1 });
  });
  return defs;
}

export function createTokenSet(defs: TokenDef[], allowedPrefixes: readonly string[]): TokenSet {
  const map = new Map<string, TokenDef>();
  for (const d of defs) if (!map.has(d.name)) map.set(d.name, d);
  const resolve = (name: string, depth = 0): string | null => {
    const def = map.get(name);
    if (!def || depth > 10) return null;
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(def.value);
    return ref ? resolve(ref[1]!, depth + 1) : def.value;
  };
  const isAllowed = (name: string) => allowedPrefixes.some((p) => name.startsWith(p));
  return { defs: map, isAllowed, canSuggest: (name) => isAllowed(name) && !map.get(name)?.deprecated, resolve: (n) => resolve(n) };
}

// ---- DTCG token files (Design Tokens Format Module 2025.10) ----------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
const isObject = (v: Json | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Style Dictionary's kebab case: `textPrimary` → `text-primary`, `Hot pink` → `hot-pink`. */
const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
/** CSS name of a token path; a group's `$root` token takes the group's name. */
const cssName = (path: string[]) => `--${(path.at(-1) === '$root' ? path.slice(0, -1) : path).map(kebab).join('-')}`;
const pointerPath = (p: string) => p.replace(/^#\//, '').split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

/**
 * Tokens of a DTCG file as CSS custom properties (see docs/policy-authoring.md for the naming rule).
 * `{a.b}` and `{ "$ref": "#/a/b/$value" }` references become `var(--a-b)`, so aliases resolve as in
 * CSS. `$type` and `$deprecated` are inherited from groups; `$extends` merges the extended group in.
 */
export function parseDtcgTokens(file: string, text: string): TokenDef[] {
  if (!text.trim()) return [];
  const doc = JSON.parse(text) as Json;
  const at = (path: string[]) => path.reduce<Json | undefined>((n, k) => (isObject(n) ? n[k] : undefined), doc);
  const target = (group: JsonObject) => {
    const ref = group.$extends;
    return typeof ref === 'string' ? /^\{([^{}]+)\}$/.exec(ref)?.[1]?.split('.') : isObject(ref) && typeof ref.$ref === 'string' ? pointerPath(ref.$ref) : undefined;
  };
  // Circular references are invalid in DTCG and would expand forever: a token file is untrusted input.
  const circular = (where: string[]) => new Error(`circular $extends at ${where.join('.')}`);
  const extended = (group: JsonObject, where: string[], chain: Set<string>): JsonObject => {
    const path = target(group);
    const base = path && at(path);
    if (!path || !isObject(base)) return group;
    if (chain.has(path.join('.'))) throw circular(where);
    return merge(extended(base, where, new Set([...chain, path.join('.')])), group);
  };
  const defs: TokenDef[] = [];
  const visit = (node: JsonObject, path: string[], type: string | undefined, deprecated: Json | undefined, expanding: Set<string>) => {
    const t = typeof node.$type === 'string' ? node.$type : type;
    const dep = node.$deprecated ?? deprecated;
    if ('$value' in node) {
      if (defs.length >= MAX_TOKENS) throw new Error(`more than ${MAX_TOKENS} tokens; check $extends for runaway expansion`);
      defs.push({ name: cssName(path), value: cssValue(node.$value!, t), file, line: 1, ...((dep === true || (typeof dep === 'string' && dep)) && { deprecated: dep }) });
      return;
    }
    if (path.length > 64) return;
    const ext = target(node)?.join('.');
    const here = path.join('.');
    // Extending an ancestor, or a group already being expanded on this path, is a cycle.
    if (ext !== undefined && (here === ext || here.startsWith(`${ext}.`) || expanding.has(ext))) throw circular(path);
    const next = ext === undefined ? expanding : new Set([...expanding, ext]);
    for (const [key, child] of Object.entries(extended(node, path, new Set(ext === undefined ? [] : [here])))) {
      if ((key === '$root' || !key.startsWith('$')) && isObject(child)) visit(child, [...path, key], t, dep, next);
    }
  };
  if (isObject(doc)) visit(doc, [], undefined, undefined, new Set());
  return defs;
}

/** Far beyond real token sets; a cap so hostile `$extends` fan-out fails fast instead of exhausting memory. */
const MAX_TOKENS = 100_000;

/** Deep merge for `$extends`: local tokens and groups override inherited ones at the same path. */
function merge(base: JsonObject, local: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(local)) {
    const b = out[key];
    out[key] = isObject(b) && isObject(value) && !('$value' in b) && !('$value' in value) ? merge(b, value) : value;
  }
  delete out.$extends; // already applied
  return out;
}

function cssValue(v: Json, type: string | undefined): string {
  if (typeof v === 'string') {
    const alias = /^\{([^{}]+)\}$/.exec(v);
    return alias ? `var(${cssName(alias[1]!.split('.'))})` : v;
  }
  if (typeof v === 'number') return String(v);
  if (isObject(v)) {
    if (typeof v.$ref === 'string' && /\/\$value$/.test(v.$ref)) return `var(${cssName(pointerPath(v.$ref).slice(0, -1))})`;
    if (typeof v.colorSpace === 'string' && Array.isArray(v.components)) return cssColor(v);
    if (typeof v.value === 'number' && typeof v.unit === 'string') return `${v.value}${v.unit}`; // dimension, duration
  }
  if (Array.isArray(v) && type === 'cubicBezier') return `cubic-bezier(${v.join(', ')})`;
  if (Array.isArray(v) && type === 'fontFamily') return v.map((f) => (typeof f === 'string' && /[\s,'"]/.test(f) ? JSON.stringify(f) : String(f))).join(', ');
  return JSON.stringify(v); // composite values (shadow, typography, …) are compared as data, not read as CSS
}

/** A DTCG color as CSS: its hex fallback or computed sRGB hex when possible (so suggestions can match), else a color function. */
function cssColor(c: JsonObject): string {
  const alpha = typeof c.alpha === 'number' ? c.alpha : 1;
  const comps = (c.components as Json[]).map((x) => (typeof x === 'number' ? x : 'none'));
  const byte = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0');
  const a = alpha < 1 ? byte(alpha) : '';
  if (typeof c.hex === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex)) return c.hex.toLowerCase() + a;
  if (c.colorSpace === 'srgb' && comps.every((x) => typeof x === 'number')) return `#${comps.map((x) => byte(x as number)).join('')}${a}`;
  const slash = alpha < 1 ? ` / ${alpha}` : '';
  const pct = (x: number | string | undefined) => (typeof x === 'number' ? `${x}%` : 'none');
  const space = String(c.colorSpace);
  if (space === 'hsl' || space === 'hwb') return `${space}(${comps[0]} ${pct(comps[1])} ${pct(comps[2])}${slash})`;
  if (['lab', 'lch', 'oklab', 'oklch'].includes(space)) return `${space}(${comps.join(' ')}${slash})`;
  return `color(${space} ${comps.join(' ')}${slash})`;
}

// ---- colors ---------------------------------------------------------------

export const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color']);
export const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const NAMED_COLORS = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen').split(' '),
);

type Rgb = [number, number, number];
/** Red, green, blue (0-255) and alpha (0-1). */
type Rgba = [number, number, number, number];

/** Parses hex, rgb() and hsl() colors (plus black/white). Other syntaxes return null: no suggestion is made. */
export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === 'black') return [0, 0, 0, 1];
  if (v === 'white') return [255, 255, 255, 1];
  if (HEX_COLOR.test(v)) {
    let h = v.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
    return [r, g, b, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (s: string, scale: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1);
  if (fn[1]!.startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => num(p, 255));
    return rgb.some(Number.isNaN) || Number.isNaN(alpha) ? null : [rgb[0]!, rgb[1]!, rgb[2]!, alpha];
  }
  const h = parseFloat(parts[0]!);
  const s = num(parts[1]!, 1);
  const l = num(parts[2]!, 1);
  if ([h, s, l, alpha].some(Number.isNaN)) return null;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return [f(0), f(8), f(4), alpha];
}

function toOklab([r, g, b]: Rgb | Rgba): Rgb {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance (Euclidean in OKLab) of the opaque colors. Around 0.02 is barely noticeable. */
export function colorDistance(a: Rgb | Rgba, b: Rgb | Rgba): number {
  const [x, y] = [toOklab(a), toOklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---- lengths --------------------------------------------------------------

/** Length in px for px/rem/em values (1rem = 16px); null for anything else. */
export function parseLength(value: string | number): number | null {
  if (typeof value === 'number') return value;
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return m[2] && m[2].toLowerCase() !== 'px' ? n * 16 : n;
}

export interface TokenSuggestion {
  name: string;
  value: string;
  exact: boolean;
}

/** Token-name fragments that match a CSS property's role, so a text colour is not matched to a background token. */
const ROLE_HINTS: [RegExp, string][] = [
  [/^(color|fill|stroke|caret-color|text-decoration)/, 'text'],
  [/^background/, 'bg'],
  [/^(border|outline|column-rule)/, 'border'],
];

/**
 * Closest allowed token with the given prefix, for a color or length literal. Tokens named for the
 * property's role are tried first (as Primer does), so a background never gets a border token just
 * because the value happens to match. Translucent colors get no suggestion: no opaque token is equivalent.
 */
export function nearestToken(
  tokens: TokenSet,
  literal: string | number,
  prefix: string,
  kind: 'color' | 'length',
  opts: { property?: string; exclude?: string } = {},
): TokenSuggestion | null {
  const role = opts.property ? ROLE_HINTS.find(([re]) => re.test(opts.property!))?.[1] : undefined;
  const names = [...tokens.defs.keys()].filter((n) => n.startsWith(prefix) && tokens.canSuggest(n) && n !== opts.exclude);
  const forRole = role ? closest(tokens, names.filter((n) => n.split('-').includes(role)), literal, kind) : null;
  return forRole ?? closest(tokens, names, literal, kind);
}

function closest(tokens: TokenSet, names: string[], literal: string | number, kind: 'color' | 'length'): TokenSuggestion | null {
  const color = kind === 'color' && typeof literal === 'string' ? parseColor(literal) : null;
  if (color && color[3] < 1) return null;
  let best: { name: string; value: string; d: number } | null = null;
  for (const name of names) {
    const value = tokens.resolve(name);
    if (value === null) continue;
    let d: number | null = null;
    if (kind === 'color') {
      const b = parseColor(value);
      if (color && b && b[3] === 1) d = colorDistance(color, b);
    } else {
      const [a, b] = [parseLength(literal), parseLength(value)];
      if (a !== null && b !== null) d = Math.abs(a - b);
    }
    if (d !== null && (!best || d < best.d)) best = { name, value, d };
  }
  if (!best) return null;
  // Too far away to be a helpful suggestion (about a clearly different hue, or a different spacing step).
  const lit = kind === 'length' ? Math.abs(parseLength(literal) ?? 0) : 0;
  if (kind === 'color' ? best.d > 0.15 : best.d > Math.max(4, lit * 0.25)) return null;
  return { name: best.name, value: best.value, exact: best.d < (kind === 'color' ? 0.005 : 0.5) };
}

/** `var(--x)` names referenced in a CSS value, including inside fallbacks and calc(). */
export function varReferences(value: string): string[] {
  const names: string[] = [];
  valueParser(value).walk((n) => {
    if (n.type === 'function' && n.value === 'var' && n.nodes[0]?.type === 'word') names.push(n.nodes[0].value);
  });
  return names;
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}
