import path from 'node:path';
import type { Evidence, FindingDraft } from '@design-warden/core';
import { z } from 'zod';
import { defineCheck, type SourceProject } from '../check.ts';
import { snippetAt } from '../parse.ts';
import { createTokenSet, readTokenDefs, type TokenSet } from '../tokens.ts';

const reaction = z.enum(['review', 'notice', 'off']);

export const patternProvenance = defineCheck({
  id: 'pattern-provenance',
  engine: 'source',
  description:
    'Classifies changed components as established, modified, novel or insufficient-evidence against reference patterns and existing components; reports the classes the policy asks for.',
  options: z.strictObject({
    novel: reaction.default('review'),
    modified: reaction.default('notice'),
    insufficientEvidence: reaction.default('notice'),
    minElements: z.int().positive().default(3),
    establishedThreshold: z.number().min(0).max(1).default(0.6),
    modifiedThreshold: z.number().min(0).max(1).default(0.3),
  }),
  async runProject(ctx) {
    const inScope = new Set(ctx.targets.map((t) => t.path));
    const out: FindingDraft[] = [];
    for (const r of ctx.project.provenance) {
      if (!inScope.has(r.file) || r.classification === 'established') continue;
      const mode = r.classification === 'novel' ? ctx.options.novel : r.classification === 'modified' ? ctx.options.modified : ctx.options.insufficientEvidence;
      if (mode === 'off') continue;
      const lead =
        r.classification === 'novel'
          ? `\`${r.component}\` is a novel pattern. This is not a violation; confirm it is justified by the design guidance.`
          : r.classification === 'modified'
            ? `\`${r.component}\` modifies an established pattern.`
            : `Provenance of \`${r.component}\` could not be determined.`;
      const file = ctx.project.files.get(r.file)!;
      out.push({
        ruleId: ctx.ruleId,
        check: 'pattern-provenance',
        verdict: mode === 'review' ? 'insufficient-evidence' : 'notice',
        confidence: 'medium',
        origin: 'heuristic',
        engine: 'source',
        message: `${lead} ${r.explanation}`,
        // The whole component span, so a change anywhere inside it keeps the finding in scope.
        location: { file: r.file, line: r.line, endLine: r.endLine },
        spanText: file.lines.slice(r.line - 1, r.endLine).join('\n'),
        evidence: [
          { kind: 'code', file: r.file, line: r.line, snippet: snippetAt(file, r.line) },
          {
            kind: 'note',
            text: `Design-system components: ${r.signals.designSystemComponents.join(', ') || 'none'}; raw elements: ${r.signals.rawElements.join(', ') || 'none'}${r.signals.dynamic.length ? `; dynamic: ${r.signals.dynamic.join(', ')}` : ''}.`,
          },
        ],
      });
    }
    return out;
  },
});

export const sharedChange = defineCheck({
  id: 'shared-change',
  engine: 'source',
  description:
    'Reports changes to design tokens and shared design-system files with their downstream usages, so owners can review the blast radius.',
  options: z.strictObject({ maxUsagesListed: z.int().positive().default(25) }),
  async runProject(ctx) {
    const { project } = ctx;
    if (!project.changes || !project.readBase) return [];
    const out: FindingDraft[] = [];
    for (const target of ctx.targets) {
      const change = project.changes.files.find((f) => f.path === target.path);
      if (!change) continue;
      const line = change.changedLines[0]?.start ?? 1;
      const location = { file: target.path, line: Math.min(line, target.lines.length) };
      if (project.tokenFiles.has(target.path)) {
        // Every token in every theme, as resolved values: a changed primitive also reports every semantic token that aliases
        // it, and a theme override (`.dark { --palette-bg }`) every token built on it in that theme.
        const before = createTokenSet(readTokenDefs(target.path, (await project.readBase(change.previousPath ?? target.path)) ?? ''), []);
        const after = createTokenSet(readTokenDefs(target.path, target.text), []);
        const themes = [...new Set([before, after].flatMap((set) => [...set.defs.keys()].flatMap((n) => set.definitions(n).flatMap((d) => (d.selector === undefined ? [] : [d.selector])))))];
        const evidence: Evidence[] = [];
        const usages = new Map<string, string[]>(); // per token: one project scan, one count, however many themes changed
        const removed = new Set<string>();
        for (const name of new Set([...before.defs.keys(), ...after.defs.keys()])) {
          // A token with no definition left breaks its references; removing one theme's override leaves the others in force.
          if (!after.defs.has(name)) removed.add(name);
          for (const selector of [undefined, ...themes]) {
            // A theme is listed only where it gives the token its own value, directly or through an alias, in either version.
            const own = (set: TokenSet) => selector === undefined || valueIn(set, name, selector) !== valueIn(set, name);
            if (!own(before) && !own(after)) continue;
            const [b, a] = [valueIn(before, name, selector), valueIn(after, name, selector)];
            if (b === a) continue;
            if (!usages.has(name)) usages.set(name, tokenUsages(project, name));
            evidence.push({ kind: 'token-change', token: name, ...(selector !== undefined && { selector }), before: b, after: a, usages: usages.get(name)!.slice(0, ctx.options.maxUsagesListed) });
          }
        }
        if (!evidence.length) continue;
        const affected = [...usages.values()].reduce((n, u) => n + u.length, 0);
        const brokenRefs = [...removed].reduce((n, name) => n + usages.get(name)!.length, 0);
        out.push({
          ruleId: ctx.ruleId,
          check: 'shared-change',
          verdict: 'violation',
          confidence: 'high',
          origin: 'deterministic',
          engine: 'source',
          location,
          message:
            `${usages.size} design token(s) changed in ${target.path}, affecting ${affected} usage(s).` +
            (brokenRefs ? ` ${brokenRefs} usage(s) reference removed tokens and will break.` : ''),
          evidence,
        });
      } else if (project.inDesignSystem(target.path)) {
        const components = componentsFor(project, target.path);
        const usages = components.length ? componentUsages(project, new Set(components)) : [];
        out.push({
          ruleId: ctx.ruleId,
          check: 'shared-change',
          verdict: 'violation',
          confidence: 'high',
          origin: 'deterministic',
          engine: 'source',
          location,
          message: components.length
            ? `Shared design-system file changed (${components.join(', ')}); ${usages.length} usage(s) across the application are affected.`
            : `Shared design-system file changed: ${target.path}.`,
          evidence: [
            { kind: 'code', file: target.path, line: location.line, snippet: snippetAt(target, location.line) },
            ...usages.slice(0, ctx.options.maxUsagesListed).map((u): Evidence => ({ kind: 'usage', ...u })),
          ],
        });
      }
    }
    return out;
  },
});

/** A token's value in a theme (the default without one): resolved, or as written when it refers outside this file. */
function valueIn(set: TokenSet, name: string, selector?: string): string | null {
  const defs = set.definitions(name);
  return set.resolve(name, selector) ?? (defs.find((d) => d.selector === selector) ?? defs.find((d) => d.selector === undefined))?.value ?? null;
}

/** Repository search for var(--name) references outside the token sources, as "file:line". */
function tokenUsages(project: SourceProject, name: string): string[] {
  const re = new RegExp(`var\\(\\s*${name.replace(/[-]/g, '\\-')}\\s*[,)]`);
  const hits: string[] = [];
  for (const f of project.files.values()) {
    if (project.tokenFiles.has(f.path)) continue;
    f.lines.forEach((l, i) => {
      if (re.test(l)) hits.push(`${f.path}:${i + 1}`);
    });
  }
  return hits;
}

/** Registry components implemented by a file, matching its source or a sibling with the same base name (Button.css -> Button.tsx). */
function componentsFor(project: SourceProject, file: string): string[] {
  const stem = (p: string) => path.posix.join(path.posix.dirname(p), path.posix.basename(p).split('.')[0]!);
  return project.policy.components.filter((c) => c.source === file || stem(c.source) === stem(file)).map((c) => c.name);
}

function componentUsages(project: SourceProject, names: Set<string>): { file: string; line: number; detail: string }[] {
  const out: { file: string; line: number; detail: string }[] = [];
  for (const f of project.files.values()) {
    if (project.inDesignSystem(f.path) || !f.ast) continue;
    for (const u of project.usages(f)) {
      if (u.resolved.kind === 'design-system' && names.has(u.resolved.component)) out.push({ file: f.path, line: u.line, detail: `<${u.resolved.component}>` });
    }
  }
  return out;
}

export const projectChecks = [patternProvenance, sharedChange];
