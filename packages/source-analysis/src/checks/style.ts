import type { FindingDraft } from '@design-warden/core';
import valueParser from 'postcss-value-parser';
import { z } from 'zod';
import { defineCheck, fileFinding, type FileCheckContext } from '../check.ts';
import { styleValues, type StyleValue } from '../style-values.ts';
import { COLOR_FUNCTIONS, HEX_COLOR, NAMED_COLORS, levenshtein, nearestToken, parseLength, varReferences, type TokenSet } from '../tokens.ts';

const COLOR_PROPERTY = /colou?r|background|border|outline|fill|stroke|shadow|caret|accent|text-decoration|column-rule/i;
const SHADOW_PROPERTY = /^(box-shadow|text-shadow)$/;

const located = (sv: StyleValue) => ({ line: sv.line, column: sv.column, endLine: sv.endLine });
const where = (sv: StyleValue) =>
  sv.source === 'css' || sv.source === 'css-in-js' ? `\`${sv.property}\`` : sv.source === 'jsx-style' ? `inline style \`${sv.property}\`` : sv.source === 'jsx-class' ? `class \`${sv.className}\`` : `prop \`${sv.property}\``;
/** What cannot be read and why: CSS that does not parse, a Sass mixin, a computed property, or a style object built elsewhere. */
const unreadable = (sv: StyleValue) => sv.lead ?? `Inline style object \`${sv.expression}\` is built elsewhere`;
const skipTokenSources = (ctx: FileCheckContext<unknown>) => ctx.project.tokenFiles.has(ctx.file.path);
const replaceLast = (s: string, find: string, by: string) => {
  const i = s.lastIndexOf(find);
  return i < 0 ? s : s.slice(0, i) + by + s.slice(i + find.length);
};

/** A literal found in a CSS value, and the token whose var() fallback it is, if any. */
interface Literal {
  text: string;
  fallbackOf?: string;
}

/** Walks a CSS value, tracking whether a node sits in the fallback of a var(). */
function literals(value: string, pick: (n: valueParser.Node) => string | null | false): Literal[] {
  const found: Literal[] = [];
  const visit = (nodes: valueParser.Node[], fallbackOf?: string) => {
    for (const n of nodes) {
      if (n.type === 'function' && n.value === 'var') {
        const [name, , ...rest] = n.nodes; // var(--name , fallback…)
        visit(rest, name?.type === 'word' ? name.value : fallbackOf);
        continue;
      }
      const hit = pick(n);
      if (hit === false) continue; // do not descend
      if (hit) {
        found.push({ text: hit, fallbackOf });
        continue;
      }
      if (n.type === 'function') visit(n.nodes, fallbackOf);
    }
  };
  visit(valueParser(value).nodes);
  return found;
}

const fallbackSuggestion = (tokens: TokenSet, name: string) =>
  tokens.defs.has(name) ? `Remove the fallback: var(${name}) is a defined token.` : undefined;

export const noHardcodedColor = defineCheck({
  id: 'no-hardcoded-color',
  engine: 'source',
  description: 'Flags literal colors (hex, rgb(), hsl(), named colors) in CSS, inline styles and color props; suggests the nearest allowed token.',
  options: z.strictObject({
    allow: z.array(z.string()).default(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'none']),
    tokenPrefix: z.string().default('--color-'),
  }),
  runFile(ctx) {
    if (skipTokenSources(ctx)) return [];
    const { tokens } = ctx.project;
    const allow = new Set(ctx.options.allow.map((a) => a.toLowerCase()));
    const out: FindingDraft[] = [];
    for (const sv of styleValues(ctx.file)) {
      if (sv.wholeObject || (sv.value === null && COLOR_PROPERTY.test(sv.property))) {
        out.push(
          fileFinding(ctx, 'no-hardcoded-color', located(sv), {
            verdict: 'insufficient-evidence',
            confidence: 'medium',
            message: sv.wholeObject
              ? `${unreadable(sv)}; static analysis cannot confirm its colors are tokens.`
              : `${where(sv)} is computed from \`${sv.expression}\`; static analysis cannot confirm it resolves to a color token.`,
            suggestion: 'Pass a token reference (e.g. a tone prop mapped to var(--color-*)) instead of a raw value, or add a reviewed exception.',
          }),
        );
        continue;
      }
      if (typeof sv.value !== 'string') continue;
      const namedAllowed = COLOR_PROPERTY.test(sv.property) || sv.source === 'jsx-prop';
      const found = literals(sv.value, (n) => {
        if (n.type === 'function') {
          if (n.value === 'url') return false;
          return COLOR_FUNCTIONS.has(n.value.toLowerCase()) ? valueParser.stringify(n) : null;
        }
        return n.type === 'word' && (HEX_COLOR.test(n.value) || (namedAllowed && NAMED_COLORS.has(n.value.toLowerCase()))) ? n.value : null;
      });
      for (const lit of found) {
        if (allow.has(lit.text.toLowerCase())) continue;
        let suggestion: string | undefined;
        if (lit.fallbackOf) suggestion = fallbackSuggestion(tokens, lit.fallbackOf);
        else if (SHADOW_PROPERTY.test(sv.property)) {
          const shadows = [...tokens.defs.keys()].filter((n) => n.startsWith('--shadow-') && tokens.canSuggest(n));
          suggestion = shadows.length ? `Use a shadow token such as ${shadows.slice(0, 3).map((n) => `var(${n})`).join(' or ')}.` : undefined;
        } else {
          const near = nearestToken(tokens, lit.text, ctx.options.tokenPrefix, 'color', {
            property: sv.source === 'jsx-prop' ? 'color' : sv.property,
            exclude: sv.definesCustomProperty ? sv.property : undefined,
          });
          if (near) suggestion = `Use var(${near.name})${near.exact ? ', which has exactly this value' : `, the closest allowed token (${near.value})`}.`;
        }
        out.push(
          fileFinding(ctx, 'no-hardcoded-color', located(sv), {
            verdict: 'violation',
            message: lit.fallbackOf
              ? `Hardcoded fallback color \`${lit.text}\` in var(${lit.fallbackOf}, …).`
              : `Hardcoded color \`${lit.text}\` in ${where(sv)}${sv.definesCustomProperty ? ' (custom property defined outside the token sources)' : ''}.`,
            suggestion,
          }),
        );
      }
    }
    return out;
  },
});

const SPACING_PROPERTIES = ['margin', 'padding']
  .flatMap((p) => [p, `${p}-top`, `${p}-right`, `${p}-bottom`, `${p}-left`, `${p}-inline`, `${p}-inline-start`, `${p}-inline-end`, `${p}-block`, `${p}-block-start`, `${p}-block-end`])
  .concat(['gap', 'row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap']);

// Only lengths with a unit. Bare numbers in CSS are multipliers (calc(var(--space-4) * -1)), not spacing.
const LENGTH_WITH_UNIT = /^-?\d*\.?\d+(px|rem|em)$/i;

export const spacingScale = defineCheck({
  id: 'spacing-scale',
  engine: 'source',
  description:
    'Requires lengths in the given properties (default: margins, paddings, gaps) to use one token scale (default --space-*); flags literals in the given units (default px, rem, em) and suggests the nearest step.',
  options: z.strictObject({
    properties: z.array(z.string()).default(SPACING_PROPERTIES),
    allow: z.array(z.string()).default(['0', 'auto', 'inherit', 'initial', 'unset']),
    tokenPrefix: z.string().default('--space-'),
    // em is relative to the element's font size: a typography scale usually lists only px and rem.
    units: z.array(z.enum(['px', 'rem', 'em'])).min(1).default(['px', 'rem', 'em']),
  }),
  runFile(ctx) {
    if (skipTokenSources(ctx)) return [];
    const props = new Set(ctx.options.properties);
    const allow = new Set(ctx.options.allow);
    const units = new Set<string>(ctx.options.units);
    const scale = `\`${ctx.options.tokenPrefix}*\` scale`; // the same check serves spacing, font sizes and other length scales
    const out: FindingDraft[] = [];
    for (const sv of styleValues(ctx.file)) {
      if (sv.wholeObject || (sv.value === null && props.has(sv.property))) {
        out.push(
          fileFinding(ctx, 'spacing-scale', located(sv), {
            verdict: 'insufficient-evidence',
            confidence: 'medium',
            message: sv.wholeObject
              ? `${unreadable(sv)}; static analysis cannot confirm its values use the ${scale}.`
              : `${where(sv)} is computed from \`${sv.expression}\`; static analysis cannot confirm it uses the ${scale}.`,
          }),
        );
        continue;
      }
      if (!props.has(sv.property)) continue;
      const found: Literal[] =
        typeof sv.value === 'number'
          ? sv.value === 0 || !units.has('px') ? [] : [{ text: `${sv.value}px` }] // React treats numbers as px
          : typeof sv.value === 'string'
            ? literals(sv.value, (n) => (n.type === 'word' && units.has(LENGTH_WITH_UNIT.exec(n.value)?.[1]?.toLowerCase() ?? '') ? n.value : null)).filter((l) => !allow.has(l.text) && parseLength(l.text) !== 0)
            : [];
      for (const lit of found) {
        const near = lit.fallbackOf ? null : nearestToken(ctx.project.tokens, lit.text, ctx.options.tokenPrefix, 'length');
        out.push(
          fileFinding(ctx, 'spacing-scale', located(sv), {
            verdict: 'violation',
            message: lit.fallbackOf
              ? `Hardcoded fallback \`${lit.text}\` in var(${lit.fallbackOf}, …).`
              : near?.exact
                ? `\`${lit.text}\` in ${where(sv)} is hardcoded; the ${scale} has a token for it.`
                : `\`${lit.text}\` in ${where(sv)} is not on the ${scale}.`,
            suggestion: lit.fallbackOf
              ? fallbackSuggestion(ctx.project.tokens, lit.fallbackOf)
              : near ? `Use var(${near.name}) (${near.value})${near.exact ? '' : ', the nearest step'}.` : undefined,
          }),
        );
      }
    }
    return out;
  },
});

export const tokenUsage = defineCheck({
  id: 'token-usage',
  engine: 'source',
  description:
    'Every var(--token) must be a defined token with an allowed (semantic) prefix, or a custom property defined in the same file; design tokens may only be defined in the token sources.',
  options: z.strictObject({}),
  runFile(ctx) {
    if (skipTokenSources(ctx)) return [];
    const { tokens } = ctx.project;
    const values = styleValues(ctx.file);
    const local = new Set(values.filter((v) => v.definesCustomProperty).map((v) => v.property));
    const allowedNames = [...tokens.defs.keys()].filter((n) => tokens.canSuggest(n));
    const out: FindingDraft[] = [];
    for (const sv of values) {
      if (sv.definesCustomProperty && tokens.defs.has(sv.property)) {
        out.push(
          fileFinding(ctx, 'token-usage', located(sv), {
            verdict: 'violation',
            message: `\`${sv.property}\` redefines a design token outside the token sources.`,
            suggestion: 'Change tokens in the token sources, where owners review them, or give this local value its own name (for example --orders-gap).',
          }),
        );
      }
      if (typeof sv.value !== 'string') continue;
      // A palette class means a Tailwind token only in a Tailwind project, and not when the project styles that class itself.
      if (sv.theme && (!ctx.project.usesTailwind() || ctx.project.styledBy(sv.theme).length > 0)) continue;
      // A palette class (`hover:bg-red-500`) references its token through the class: name the class, and suggest classes.
      const subject = (name: string) => (sv.theme ? `Class \`${sv.className}\` uses \`${name}\`, which` : `\`${name}\``);
      const ref = (name: string, token: string) =>
        sv.theme && token.startsWith('--color-') ? `\`${replaceLast(sv.className!, name.slice('--color-'.length), token.slice('--color-'.length))}\` (var(${token}))` : `var(${token})`;
      for (const name of varReferences(sv.value)) {
        const def = tokens.defs.get(name);
        if (!def && local.has(name)) continue;
        if (def && tokens.isAllowed(name)) {
          if (def.deprecated) {
            out.push(fileFinding(ctx, 'token-usage', located(sv), { verdict: 'violation', message: `${subject(name)} is deprecated${def.deprecated === true ? '.' : `: ${def.deprecated}`}` }));
          }
          continue;
        }
        if (!def) {
          const close = allowedNames.map((n) => [n, levenshtein(n, name)] as const).sort((a, b) => a[1] - b[1])[0];
          out.push(
            fileFinding(ctx, 'token-usage', located(sv), {
              verdict: 'violation',
              message: `${subject(name)} is not a defined design token.`,
              suggestion: close && close[1] <= 3 ? `Did you mean ${ref(name, close[0])}?` : undefined,
            }),
          );
        } else {
          const resolved = tokens.resolve(name);
          const same = allowedNames.filter((n) => resolved !== null && tokens.resolve(n) === resolved);
          const use = same.slice(0, 3);
          out.push(
            fileFinding(ctx, 'token-usage', located(sv), {
              verdict: 'violation',
              message: `${subject(name)} is an internal token; application code must use semantic tokens.`,
              suggestion: !use.length
                ? undefined
                : sv.theme
                  ? `Use ${use.map((t) => ref(name, t)).join(' or ')}, which ${use.length === 1 ? 'has' : 'have'} the same value.`
                  : `Use ${use.map((n) => `var(${n})`).join(' or ')}, which resolve to the same value.`,
            }),
          );
        }
      }
    }
    return out;
  },
});

/**
 * Contract: a `.css` declaration flagged `!important` (any spacing or case, custom properties and
 * at-rules included) is a violation, one per declaration. `!important` inside a comment, string or
 * url() is not a flag and is never reported. TS/TSX is not checked. No insufficient-evidence case:
 * the flag is syntax. Design-system and token-source files are excluded by the rule's scope.
 */
export const noImportant = defineCheck({
  id: 'no-important',
  engine: 'source',
  description: 'Flags `!important` in CSS declarations; win the cascade with specificity, order or a component variant instead.',
  options: z.strictObject({}),
  runFile(ctx) {
    return styleValues(ctx.file)
      .filter((sv) => sv.important)
      .map((sv) =>
        fileFinding(ctx, 'no-important', located(sv), {
          verdict: 'violation',
          message: `\`${sv.property}\` is declared \`!important\`.`,
          suggestion: 'Remove `!important`. If the declaration then loses, fix the selector specificity or order, or use the component variant, instead of forcing it.',
        }),
      );
  },
});

export const styleChecks = [noHardcodedColor, spacingScale, tokenUsage, noImportant];
