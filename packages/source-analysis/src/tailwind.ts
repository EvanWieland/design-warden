// Tailwind classes with arbitrary values, read as the CSS they produce, and color utilities that name the
// default palette, read as the theme variable they reference. No Tailwind dependency: other theme classes
// such as `p-4` depend on the project's Tailwind config and are not judged.

/** Utility prefixes the style checks care about, mapped to the CSS property they set. */
const PROPERTY: Record<string, string> = {
  p: 'padding', px: 'padding-inline', py: 'padding-block', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left', ps: 'padding-inline-start', pe: 'padding-inline-end',
  m: 'margin', mx: 'margin-inline', my: 'margin-block', mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', ms: 'margin-inline-start', me: 'margin-inline-end',
  gap: 'gap', 'gap-x': 'column-gap', 'gap-y': 'row-gap', 'space-x': 'margin-inline-start', 'space-y': 'margin-block-start',
  bg: 'background', from: 'background-image', via: 'background-image', to: 'background-image',
  border: 'border', 'border-x': 'border', 'border-y': 'border', 'border-t': 'border', 'border-r': 'border', 'border-b': 'border', 'border-l': 'border', 'border-s': 'border', 'border-e': 'border',
  divide: 'border-color', outline: 'outline', ring: 'outline-color', 'ring-offset': 'outline-color',
  fill: 'fill', stroke: 'stroke', decoration: 'text-decoration-color', accent: 'accent-color', caret: 'caret-color', placeholder: 'color',
  shadow: 'box-shadow', 'inset-shadow': 'box-shadow', 'text-shadow': 'text-shadow',
};
const TYPE_HINT = /^(?:color|length|percentage|number|integer|url|image|position|size|bg-size|line-width|family-name|absolute-size|relative-size|shadow|vector|angle|any):/;
const LENGTH_LIKE = /^(?:-?\.?\d|calc\(|clamp\(|min\(|max\()/;

/**
 * The property and value a class with an arbitrary value sets, or null for any other class.
 * `md:hover:-mt-[8px]` → margin-top `calc(8px * -1)`, `bg-[#fff]/50` → background `#fff`,
 * `[padding:13px]` → padding `13px`, `p-(--gap)` (v4) → padding `var(--gap)`.
 * Unlisted utilities keep their prefix as the property, so token references in them are still read.
 */
export function arbitraryValue(cls: string): { property: string; value: string } | null {
  let u = cls.slice(variantEnd(cls)).replace(/^!|!$/g, ''); // important modifier: !p-1 (v3), p-1! (v4)
  const negative = u.startsWith('-');
  if (negative) u = u.slice(1);
  if (u.startsWith('[')) {
    const m = /^\[(--[\w-]+|[a-z-]+):(.+)\]$/.exec(u);
    return m ? { property: m[1]!, value: decode(m[2]!) } : null;
  }
  const open = u.search(/-[[(]/);
  if (open < 1) return null;
  const close = matching(u, open + 1);
  if (close < 0 || (close < u.length - 1 && u[close + 1] !== '/')) return null; // only an opacity modifier may follow
  const prefix = u.slice(0, open);
  let hint = '';
  let value = decode(u.slice(open + 2, close)).replace(TYPE_HINT, (h) => ((hint = h), ''));
  if (u[open + 1] === '(') value = `var(${value})`;
  if (negative) value = `calc(${value} * -1)`; // what Tailwind generates
  const property = prefix === 'text' ? (hint === 'length:' || (!hint && LENGTH_LIKE.test(value)) ? 'font-size' : 'color') : (PROPERTY[prefix] ?? prefix);
  return { property, value };
}

// The default palette as of Tailwind 4.3 (taupe, mauve, mist and olive came in 4.2).
const PALETTE = '(?:slate|gray|zinc|neutral|stone|taupe|mauve|mist|olive|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|black|white';
// The palette is part of the pattern, so `text-shadow-red-500` backtracks to the `text-shadow` utility.
const PALETTE_UTILITY = new RegExp(`^(bg|text|border(?:-[xytrblse])?|divide|outline|ring(?:-offset)?|inset-ring|fill|stroke|decoration|accent|caret|placeholder|from|via|to|shadow|inset-shadow|text-shadow|drop-shadow)-(${PALETTE})$`);

/**
 * A color utility that names Tailwind's default palette (`hover:bg-red-500/50`), read as the theme
 * variable Tailwind v4 compiles it to: `var(--color-red-500)`. `utility` is the class without variants and opacity. Other theme
 * classes are not judged: sizes and keywords (`text-sm`, `border-2`) are not colors, and a project's own
 * color names (`bg-danger`) are its tokens.
 */
export function themeColor(cls: string): { property: string; value: string; utility: string } | null {
  const u = cls
    .slice(variantEnd(cls))
    .replace(/^!|!$/g, '')
    .replace(/\/(?:\d+|\[[^\]]*\]|\([^)]*\))$/, ''); // opacity modifier: /50, /[0.35], /(--alpha)
  const m = PALETTE_UTILITY.exec(u);
  if (!m) return null;
  const [utility, prefix, color] = m as unknown as [string, string, string];
  return { property: prefix === 'text' ? 'color' : (PROPERTY[prefix] ?? prefix), value: `var(--color-${color})`, utility };
}

/** Index after the last variant (`md:`, `data-[state=open]:`), ignoring colons inside brackets. */
function variantEnd(cls: string): number {
  let depth = 0;
  let end = 0;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) end = i + 1;
  }
  return end;
}

function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '[' || s[i] === '(') depth++;
    else if ((s[i] === ']' || s[i] === ')') && --depth === 0) return i;
  }
  return -1;
}

/** Underscores are spaces in arbitrary values; `\_` is a literal underscore. Math gets the spaces Tailwind adds: `calc(1rem+2px)`. */
const decode = (s: string) => spaceMath(s.replace(/\\_/g, '\0').replace(/_/g, ' ').replace(/\0/g, '_'));

/**
 * `calc(100%-13px)` → `calc(100% - 13px)`: an operator between a whole number (with its unit) or `)` and a number, `(` or var().
 * A number inside a name (`--size-ctl-2-5`) follows a letter, dot or dash, so it is left alone.
 */
const spaceMath = (v: string) => (/\b(?:calc|clamp|min|max)\(/.test(v) ? v.replace(/((?<![\w.-])\d*\.?\d+(?:[a-z]+|%)?|\))([-+*/])(?=[\d.(]|var\()/gi, '$1 $2 ') : v);
