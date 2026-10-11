import { isLineChanged, matchesAny, type ProvenanceClass, type ProvenanceRecord } from '@design-warden/core';
import type { SourceProject } from './check.ts';
import { componentDefinitions, features, importsOf, jaccard, jsxUsages, shapeTree, treeSimilarity, type ComponentDefinition, type JsxUsage, type Tree } from './jsx.ts';
import { parseFile, type ParsedFile } from './parse.ts';

export interface ProvenanceOptions {
  minElements: number;
  establishedThreshold: number;
  modifiedThreshold: number;
}

interface Reference {
  kind: 'pattern' | 'component';
  id: string;
  source: string;
  features: Set<string>;
  tree: Tree;
}

/**
 * Classifies changed component definitions against precedent (ADR 0009):
 * reference patterns from the policy and existing components in unchanged files.
 * Similarity needs two signals to agree: composition (Jaccard over the rendered component and element
 * kinds) and shape (tree edit distance over their nesting). The lower one counts, so the same
 * components in a different layout are not "established". Props are ignored.
 */
export async function computeProvenance(project: SourceProject, opts: ProvenanceOptions): Promise<ProvenanceRecord[]> {
  const changes = project.changes;
  if (!changes) return [];
  const changed = new Map(changes.files.filter((f) => f.status !== 'deleted').map((f) => [f.path, f]));
  const references = await buildReferences(project, new Set(changed.keys()));
  const records: ProvenanceRecord[] = [];

  for (const [path, change] of changed) {
    const file = project.files.get(path);
    if (!file?.ast || project.inDesignSystem(path)) continue;
    const baseDefs = change.status === 'added' ? new Map<string, ComponentDefinition>() : await baseDefinitions(project, change.previousPath ?? path);
    for (const def of project.definitions(file)) {
      if (change.status !== 'added' && !isLineChanged(change, def.line, def.endLine)) continue;
      records.push(classify(file, def, baseDefs.get(def.name), references, opts));
    }
  }
  return records;
}

function classify(file: ParsedFile, def: ComponentDefinition, base: ComponentDefinition | undefined, refs: Reference[], opts: ProvenanceOptions): ProvenanceRecord {
  const f = features(def.usages);
  const tree = shapeTree(def.usages);
  const signals = {
    designSystemComponents: [...new Set(def.usages.flatMap((u) => (u.resolved.kind === 'design-system' ? [u.resolved.component] : [])))],
    rawElements: [...new Set(def.usages.flatMap((u) => (u.resolved.kind === 'intrinsic' ? [u.resolved.element] : [])))],
    elementCount: def.usages.length,
    dynamic: def.dynamic,
  };
  const record = (classification: ProvenanceClass, explanation: string, nearest?: ProvenanceRecord['nearest']): ProvenanceRecord => ({
    file: file.path,
    component: def.name,
    line: def.line,
    endLine: def.endLine,
    classification,
    nearest,
    signals,
    explanation,
  });

  if (base) {
    const sim = Math.min(jaccard(features(base.usages), f), treeSimilarity(shapeTree(base.usages), tree));
    const nearest = { kind: 'component' as const, id: def.name, source: file.path, similarity: round(sim) };
    return sim === 1 || (f.size === 0 && features(base.usages).size === 0 && treeSimilarity(shapeTree(base.usages), tree) === 1)
      ? record('established', `Existing component; its structure is unchanged by this change.`, nearest)
      : record('modified', `Existing component whose structure changed (similarity to its previous version: ${round(sim)}).`, nearest);
  }
  if (def.usages.length < opts.minElements || (def.dynamic.length > 0 && f.size < 2)) {
    return record(
      'insufficient-evidence',
      def.usages.length < opts.minElements
        ? `Only ${def.usages.length} element(s); too little structure to compare with existing patterns.`
        : `Structure is mostly dynamic (${def.dynamic.join(', ')}); static analysis cannot compare it reliably.`,
    );
  }
  let best: { ref: Reference; sim: number } | undefined;
  const ranked = refs.map((ref) => ({ ref, composition: jaccard(f, ref.features) })).sort((a, b) => b.composition - a.composition);
  for (const { ref, composition } of ranked) {
    if (best && composition <= best.sim) break; // the shape can only lower it, so no later reference can win: skip their tree edit distances
    const sim = Math.min(composition, treeSimilarity(tree, ref.tree));
    if (!best || sim > best.sim) best = { ref, sim };
  }
  const nearest = best && { kind: best.ref.kind, id: best.ref.id, source: best.ref.source, similarity: round(best.sim) };
  if (best && best.sim >= opts.establishedThreshold) {
    return record('established', `Composition and structure closely match ${best.ref.kind} "${best.ref.id}" (${round(best.sim)}).`, nearest);
  }
  if (best && best.sim >= opts.modifiedThreshold) {
    return record('modified', `Partially matches ${best.ref.kind} "${best.ref.id}" (${round(best.sim)}); a variation of an established pattern.`, nearest);
  }
  return record(
    'novel',
    best ? `No close precedent; the nearest is ${best.ref.kind} "${best.ref.id}" (${round(best.sim)}).` : 'No existing components to compare with.',
    nearest,
  );
}

async function buildReferences(project: SourceProject, changed: Set<string>): Promise<Reference[]> {
  const refs: Reference[] = [];
  for (const p of project.policy.patterns) {
    // A reference changed in this change set counts as it was before (none if it is new), so editing it cannot vouch for new code.
    const file = project.files.get(p.reference);
    const all = changed.has(p.reference) ? (await baseUsages(project, p.reference))?.usages : file && project.usages(file);
    if (!all) continue;
    refs.push({ kind: 'pattern', id: p.id, source: p.reference, features: features(all), tree: shapeTree(all) });
  }
  const patternFiles = new Set(project.policy.patterns.map((p) => p.reference));
  for (const file of project.files.values()) {
    if (!file.ast || changed.has(file.path) || patternFiles.has(file.path) || project.inDesignSystem(file.path)) continue;
    if (matchesAny(file.path, ['**/*.test.*', '**/*.spec.*', '**/*.stories.*'])) continue;
    for (const def of project.definitions(file)) {
      const f = features(def.usages);
      if (f.size) refs.push({ kind: 'component', id: def.name, source: file.path, features: f, tree: shapeTree(def.usages) });
    }
  }
  return refs;
}

async function baseUsages(project: SourceProject, path: string): Promise<{ file: ParsedFile; usages: JsxUsage[] } | undefined> {
  const text = await project.readBase?.(path);
  if (!text) return undefined;
  const file = parseFile(path, text);
  return file.ast ? { file, usages: jsxUsages(file, importsOf(file, project.isDs)) } : undefined;
}

async function baseDefinitions(project: SourceProject, path: string): Promise<Map<string, ComponentDefinition>> {
  const base = await baseUsages(project, path);
  return new Map(base ? componentDefinitions(base.file, base.usages).map((d) => [d.name, d]) : []);
}

const round = (n: number) => Math.round(n * 100) / 100;
