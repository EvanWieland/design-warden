import fs from 'node:fs';
import {
  CATEGORY_DEFAULTS,
  inScope,
  listFiles,
  matchesAny,
  resolveInside,
  ruleScope,
  type ChangeScope,
  type ChangeSet,
  type FindingDraft,
  type LoadedPolicy,
  type ProvenanceRecord,
} from '@design-warden/core';
import type { SourceCheck, SourceProject } from './check.ts';
import { componentChecks } from './checks/components.ts';
import { patternProvenance, projectChecks } from './checks/project.ts';
import { styleChecks } from './checks/style.ts';
import { componentDefinitions, globalComponents, importsOf, jsxUsages, makeComponentAt, makeDsMatcher, type ComponentDefinition, type ImportBinding, type JsxUsage } from './jsx.ts';
import { fileKind, parseFile, type ParsedFile } from './parse.ts';
import { computeProvenance, type ProvenanceOptions } from './provenance.ts';
import { customProperties, detectTailwind, indexClasses, type CustomProperties, type StyleRule } from './style-values.ts';
import { createTokenSet, readTokenDefs } from './tokens.ts';

const MAX_FILE_CHARS = 2_000_000;

export const SOURCE_CHECKS: readonly SourceCheck[] = [...styleChecks, ...componentChecks, ...projectChecks] as SourceCheck[];

export interface SourceAnalysisInput {
  loaded: LoadedPolicy;
  changes?: ChangeSet;
  scope?: ChangeScope;
  readBase?: (file: string) => Promise<string | null>;
  /** Analyze these in-memory files instead of the project's files (used by `policy test`). */
  virtualFiles?: { path: string; text: string }[];
  /** Only run these rules. */
  onlyRules?: string[];
}

export interface SourceAnalysisResult {
  drafts: FindingDraft[];
  provenance: ProvenanceRecord[];
  filesAnalyzed: number;
  /** The stylesheet rules whose selectors use a class (stylesheets and component style blocks), for naming the source of a visual change. */
  styledBy(className: string): StyleRule[];
}

export type { StyleRule };

export async function analyzeSource(input: SourceAnalysisInput): Promise<SourceAnalysisResult> {
  const { loaded, changes } = input;
  const { policy, root } = loaded;
  const read = (rel: string) => fs.readFileSync(resolveInside(root, rel), 'utf8');

  // ponytail: every in-scope file is parsed on every run, even for a one-file change (provenance and
  // shared-change impact need the whole project). Fine for thousands of files; add a content-hash parse cache if not.
  const files = new Map<string, ParsedFile>();
  for (const p of new Set([...(input.virtualFiles ? [] : listFiles(root, policy.project.include, policy.project.exclude)), ...policy.tokens.sources])) {
    const kind = fileKind(p);
    if (!kind || (kind === 'json' && !policy.tokens.sources.includes(p))) continue; // JSON is read only as a token source
    const text = read(p);
    // Oversized files (bundles, generated code) are reported as not analyzed instead of being parsed.
    files.set(p, text.length > MAX_FILE_CHARS ? { ...parseFile(p, ''), text, error: `file is larger than ${MAX_FILE_CHARS} characters` } : parseFile(p, text));
  }
  for (const v of input.virtualFiles ?? []) if (fileKind(v.path)) files.set(v.path, parseFile(v.path, v.text));
  const tokenFiles = new Set(policy.tokens.sources);
  const tokens = createTokenSet(
    policy.tokens.sources.flatMap((src) => {
      const text = files.get(src)?.text ?? read(src);
      // Token files come from the change itself: oversized ones fail the engine instead of being parsed.
      if (text.length > MAX_FILE_CHARS) throw new Error(`token source ${src} is larger than ${MAX_FILE_CHARS} characters`);
      return readTokenDefs(src, text);
    }),
    policy.tokens.allowedPrefixes,
  );

  const isDs = makeDsMatcher(policy.designSystem.importSources);
  const componentAt = makeComponentAt(policy.components);
  const memo = <T>(fn: (f: ParsedFile) => T) => {
    const cache = new Map<string, T>();
    return (f: ParsedFile) => {
      if (!cache.has(f.path)) cache.set(f.path, fn(f));
      return cache.get(f.path)!;
    };
  };
  const imports = memo((f): ImportBinding[] => importsOf(f, isDs, componentAt));
  // Vue resolves template tags against global registrations too (`app.component(…)`, usually in main.ts).
  const globals = new Map<string, ImportBinding>();
  if ([...files.values()].some((f) => f.kind === 'vue')) for (const f of files.values()) for (const [name, b] of globalComponents(f, imports(f))) globals.set(name, b);
  const usagesOf = (f: ParsedFile): JsxUsage[] => jsxUsages(f, importsOf(f, isDs, componentAt), globals);
  const usages = memo((f): JsxUsage[] => jsxUsages(f, imports(f), globals));
  let classes: Map<string, StyleRule[]> | undefined; // built on first use: only palette classes and visual changes need it
  const styledBy = (className: string) => (classes ??= indexClasses(files.values())).get(className) ?? [];
  let tailwind: boolean | undefined;
  const usesTailwind = () => (tailwind ??= detectTailwind(files.values(), () => read('package.json')));
  const definitions = memo((f): ComponentDefinition[] => componentDefinitions(f, usages(f)));
  let custom: CustomProperties | undefined;

  const project: SourceProject = {
    policy,
    tokens,
    tokenFiles,
    files,
    componentsByName: new Map(policy.components.map((c) => [c.name, c])),
    inDesignSystem: (file) => matchesAny(file, policy.designSystem.paths),
    usages,
    imports,
    usagesOf,
    styledBy,
    usesTailwind,
    definitions,
    customProperties: () => (custom ??= customProperties(files.values())),
    changes,
    readBase: input.readBase,
    provenance: [],
  };

  const provRule = policy.rules.find((r) => r.verify.by === 'check' && r.verify.check === patternProvenance.id);
  const provOptions = (provRule ? loaded.checkOptions.get(provRule.id) : patternProvenance.options.parse({})) as ProvenanceOptions;
  project.provenance = await computeProvenance(project, provOptions);

  // With a change set, per-file checks only look at changed files (ADR 0006).
  const changed = changes && input.scope !== 'all' ? new Set(changes.files.filter((f) => f.status !== 'deleted').map((f) => f.path)) : null;
  const isTarget = (p: string) => !changed || changed.has(p);
  const checks = new Map(SOURCE_CHECKS.map((c) => [c.id, c]));
  const drafts: FindingDraft[] = [];

  for (const f of files.values()) {
    if (f.error && isTarget(f.path)) {
      drafts.push({
        ruleId: 'analysis/unparseable-file',
        verdict: 'insufficient-evidence',
        confidence: 'high',
        origin: 'deterministic',
        engine: 'source',
        message: `Could not parse ${f.path}; its design rules were not checked. ${f.error}`,
        location: { file: f.path, line: 1 },
      });
    }
  }

  for (const rule of policy.rules) {
    if (rule.verify.by !== 'check' || (input.onlyRules && !input.onlyRules.includes(rule.id))) continue;
    const check = checks.get(rule.verify.check);
    if (!check) continue; // a visual check; run by the visual engine
    const { include, exclude } = ruleScope(policy, rule);
    const targets = [...files.values()].filter((f) => !f.error && isTarget(f.path) && inScope(f.path, include, exclude));
    const options = loaded.checkOptions.get(rule.id);
    if (check.runFile) for (const file of targets) drafts.push(...check.runFile({ ruleId: rule.id, options, file, project }));
    if (check.runProject) drafts.push(...(await check.runProject({ ruleId: rule.id, options, project, targets })));
  }

  drafts.push(...applyInlineDirectives(drafts, [...files.values()].filter((f) => isTarget(f.path)), loaded));
  return { drafts, provenance: project.provenance, filesAnalyzed: files.size, styledBy };
}

/**
 * `design-warden-ignore-next-line <rule-id> -- <reason>` suppresses one rule on the next line.
 * Directives without a rule id or reason, or for rules that forbid inline exceptions, are rejected
 * and reported; the finding they tried to hide stays active.
 */
function applyInlineDirectives(drafts: FindingDraft[], files: ParsedFile[], loaded: LoadedPolicy): FindingDraft[] {
  const rejected: FindingDraft[] = [];
  for (const file of files) {
    for (const d of file.directives) {
      const rule = loaded.policy.rules.find((r) => r.id === d.ruleId);
      const problem = !d.ruleId
        ? 'it does not name a rule (blanket suppressions are not supported)'
        : !rule
          ? `"${d.ruleId}" is not a rule in this policy`
          : !d.reason || d.reason.length < 10
            ? 'it gives no reason (write "-- <why this is acceptable>")'
            : !(rule.inlineExceptions ?? CATEGORY_DEFAULTS[rule.category].inlineExceptions)
              ? `"${rule.id}" is a ${rule.category} rule and cannot be suppressed inline; add a reviewed exception to the policy instead`
              : null;
      if (problem) {
        rejected.push({
          ruleId: 'policy/inline-exception-rejected',
          verdict: 'violation',
          confidence: 'high',
          origin: 'deterministic',
          engine: 'source',
          message: `Inline exception ignored: ${problem}.`,
          location: { file: file.path, line: d.commentLine },
          evidence: [{ kind: 'code', file: file.path, line: d.commentLine, snippet: (file.lines[d.commentLine - 1] ?? '').trim() }],
        });
        continue;
      }
      for (const f of drafts) {
        if (f.ruleId === d.ruleId && f.location?.file === file.path && f.location.line === d.targetLine) f.inlineSuppression = { reason: d.reason! };
      }
    }
  }
  return rejected;
}

export type { SourceCheck, SourceProject } from './check.ts';
