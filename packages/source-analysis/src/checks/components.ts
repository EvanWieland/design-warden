import type { ComponentSpec, FindingDraft } from '@design-warden/core';
import { z } from 'zod';
import { defineCheck, fileFinding } from '../check.ts';
import type { ComponentDefinition, JsxUsage } from '../jsx.ts';
import { branches, literalOf } from '../style-values.ts';

/** `tag`, `tag[attr=value]` or `[attr=value]`, as used in a component's `replaces`. */
interface Selector {
  tag?: string;
  attr?: string;
  value?: string;
  spec: ComponentSpec;
}

export function parseSelector(text: string, spec: ComponentSpec): Selector {
  const m = /^([a-z][a-z0-9-]*)?(?:\[([a-z-]+)=([^\]]+)\])?$/.exec(text.trim());
  if (!m || (!m[1] && !m[2])) throw new Error(`invalid replaces selector "${text}"`);
  return { tag: m[1], attr: m[2], value: m[3]?.replace(/^["']|["']$/g, ''), spec };
}

// An unqualified `input` selector means a text-like field. Other input types need their own selector
// (e.g. `input[type=checkbox]`) or are not reported, because no design-system component replaces them.
const TEXT_INPUT_TYPES = new Set(['text', 'email', 'search', 'number', 'tel', 'url', 'password']);

/** Literal values an attribute can take; dynamic values are not judged. */
function attributeLiterals(attr: JsxUsage['attributes'] extends Map<string, infer V> ? V : never): (string | number | boolean)[] {
  if (attr === true) return [true];
  if (!attr) return [];
  if (attr.type === 'StringLiteral') return [attr.value];
  if (attr.type !== 'JSXExpressionContainer' || attr.expression.type === 'JSXEmptyExpression') return [];
  return branches(attr.expression).flatMap((b): (string | number | boolean)[] => {
    if (b.type === 'BooleanLiteral') return [b.value];
    const lit = literalOf(b);
    return typeof lit === 'string' || typeof lit === 'number' ? [lit] : [];
  });
}

const literalAttr = (u: JsxUsage, name: string): string | null | undefined => {
  const v = u.attributes.get(name);
  if (v === undefined) return undefined; // absent
  const lits = attributeLiterals(v);
  return lits.length === 1 && typeof lits[0] === 'string' ? lits[0] : null; // null: present but not a single literal
};

export const rawElement = defineCheck({
  id: 'raw-element',
  engine: 'source',
  description:
    'Flags raw HTML elements (e.g. <button>) and ARIA-role imitations (e.g. role="button") where the component registry names a design-system replacement.',
  options: z.strictObject({ elements: z.array(z.string()).optional() }),
  runFile(ctx) {
    const selectors = ctx.project.policy.components.flatMap((c) => c.replaces.map((r) => parseSelector(r, c)));
    const out: FindingDraft[] = [];
    for (const u of ctx.project.usages(ctx.file)) {
      if (u.resolved.kind !== 'intrinsic') continue;
      // Handed to a registry component that replaces raw elements (`<Button asChild><a>`, `render={<a />}`), which styles it.
      // A trigger that only adds behaviour (Radix `DialogTrigger`) leaves the raw element as it is.
      const host = u.composedInto?.kind === 'design-system' ? ctx.project.componentsByName.get(u.composedInto.component) : undefined;
      if (host && host.replaces.length > 0) continue;
      const element = u.resolved.element;
      if (ctx.options.elements && !ctx.options.elements.includes(element)) continue;
      const role = literalAttr(u, 'role');
      const type = element === 'input' ? literalAttr(u, 'type') : undefined;
      if (type === 'hidden') continue; // no UI, nothing to replace

      // Most specific first: tag with attribute, then attribute only (ARIA role), then bare tag.
      const qualified = selectors.find((s) => s.attr && (!s.tag || s.tag === element) && literalAttr(u, s.attr) === s.value);
      const bare = selectors.find((s) => !s.attr && s.tag === element);
      const hit = qualified ?? (bare && element === 'input' && typeof type === 'string' && !TEXT_INPUT_TYPES.has(type) ? undefined : bare);
      if (!hit) continue;
      const imitation = hit.attr === 'role' && !hit.tag;
      out.push(
        fileFinding(ctx, 'raw-element', { line: u.line, endLine: u.endLine }, {
          verdict: element === 'input' && type === null && !qualified ? 'insufficient-evidence' : 'violation',
          confidence: element === 'input' && type === null && !qualified ? 'medium' : 'high',
          message: imitation
            ? `<${element} role="${role}"> imitates a control; use <${hit.spec.name}>.`
            : element === 'input' && type === null && !qualified
              ? `Raw <input> with a computed type; if it is a text field, use <${hit.spec.name}>.`
              : `Raw <${element}> bypasses the design system; use <${hit.spec.name}>.`,
          suggestion: `Replace with <${hit.spec.name}> (${hit.spec.source}), which provides the approved states, focus handling and tokens.`,
          guidance: hit.spec.guidance,
        }),
      );
    }
    return out;
  },
});

export const componentProps = defineCheck({
  id: 'component-props',
  engine: 'source',
  description: 'Checks design-system call sites against the prop contracts in the component registry (required props, allowed values).',
  options: z.strictObject({ components: z.array(z.string()).optional() }),
  runFile(ctx) {
    const out: FindingDraft[] = [];
    for (const u of ctx.project.usages(ctx.file)) {
      if (u.resolved.kind !== 'design-system') continue;
      const spec = ctx.project.componentsByName.get(u.resolved.component);
      if (!spec || (ctx.options.components && !ctx.options.components.includes(spec.name))) continue;
      const at = { line: u.line, endLine: u.endLine };
      // A required prop may come from the content (a Svelte snippet), so its absence spans the whole element there.
      const missingAt = { line: u.line, endLine: u.propsEndLine ?? u.endLine };
      for (const [prop, contract] of Object.entries(spec.props)) {
        const attr = u.attributes.get(prop);
        if (attr === undefined) {
          if (!contract.required) continue;
          out.push(
            fileFinding(ctx, 'component-props', missingAt, {
              verdict: u.hasSpread ? 'insufficient-evidence' : 'violation',
              confidence: u.hasSpread ? 'low' : 'high',
              message: u.hasSpread
                ? `<${spec.name}> has no explicit \`${prop}\` prop; it may come from spread props, which static analysis cannot see.`
                : `<${spec.name}> is missing the required \`${prop}\` prop.`,
              suggestion: `Pass \`${prop}\` explicitly${contract.allowed ? ` (one of: ${contract.allowed.join(', ')})` : ''}.`,
              guidance: spec.guidance,
            }),
          );
          continue;
        }
        if (!contract.allowed) continue;
        for (const value of attributeLiterals(attr)) {
          if (contract.allowed.includes(value)) continue;
          out.push(
            fileFinding(ctx, 'component-props', at, {
              verdict: 'violation',
              message: `<${spec.name} ${prop}=${JSON.stringify(value)}> is not an approved value.`,
              suggestion: `Use one of: ${contract.allowed.join(', ')}.`,
              guidance: spec.guidance,
            }),
          );
        }
      }
    }
    return out;
  },
});

const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export const duplicateComponent = defineCheck({
  id: 'duplicate-component',
  engine: 'source',
  description:
    'Flags new components whose name ends in a registered component name or alias (its head noun, e.g. StatusPill) but which do not use that component.',
  options: z.strictObject({}),
  runFile(ctx) {
    if (ctx.project.inDesignSystem(ctx.file.path)) return [];
    const out: FindingDraft[] = [];
    const defs = ctx.project.definitions(ctx.file);
    const byName = new Map(defs.map((d) => [d.name, d]));
    /** Renders the component: itself, a part (`Card.Header`), a variant named like it (`IconButton`), or through a component of this file. */
    const composes = (def: ComponentDefinition, spec: ComponentSpec, alias: string[], seen = new Set<string>()): boolean =>
      !seen.has(def.name) &&
      (seen.add(def.name), true) &&
      def.usages.some((u) => {
        if (u.resolved.kind === 'design-system') {
          const c = u.resolved.component;
          return c === spec.name || c.startsWith(`${spec.name}.`) || words(c).slice(-alias.length).join(' ') === alias.join(' ');
        }
        const local = u.resolved.kind === 'component' ? byName.get(u.resolved.name) : undefined;
        return !!local && composes(local, spec, alias, seen);
      });
    for (const def of defs) {
      const nameWords = words(def.name);
      for (const spec of ctx.project.policy.components) {
        // Compare with the last words of the name: "TableOfContents" is not a table, "StatusPill" is a pill.
        const hit = [spec.name, ...spec.aliases].find((alias) => {
          const a = words(alias);
          return a.length > 0 && nameWords.slice(-a.length).join(' ') === a.join(' ');
        });
        if (!hit) continue;
        if (composes(def, spec, words(hit))) continue;
        out.push(
          fileFinding(ctx, 'duplicate-component', { line: def.line, endLine: def.endLine }, {
            verdict: 'probable-violation',
            confidence: 'medium',
            origin: 'heuristic',
            message: `\`${def.name}\` looks like a re-implementation of <${spec.name}> (name matches "${hit}") but does not use it.`,
            suggestion: `Use or compose <${spec.name}> (${spec.source}). If this is a genuinely different pattern, say why in the PR or rename it.`,
            guidance: spec.guidance,
          }),
        );
        break;
      }
    }
    return out;
  },
});

export const componentChecks = [rawElement, componentProps, duplicateComponent];
