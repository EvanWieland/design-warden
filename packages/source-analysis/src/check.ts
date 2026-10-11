import type { CheckDefinition, ComponentSpec, ChangeSet, FindingDraft, Policy, ProvenanceRecord } from '@design-warden/core';
import type { z } from 'zod';
import type { ComponentDefinition, DsMatcher, JsxUsage } from './jsx.ts';
import { snippetAt, type ParsedFile } from './parse.ts';
import type { StyleRule } from './style-values.ts';
import type { TokenSet } from './tokens.ts';

/** Everything checks may read about the project. Built once per run by `analyzeSource`. */
export interface SourceProject {
  policy: Policy;
  tokens: TokenSet;
  tokenFiles: Set<string>;
  files: Map<string, ParsedFile>;
  componentsByName: Map<string, ComponentSpec>;
  isDs: DsMatcher;
  inDesignSystem(file: string): boolean;
  usages(file: ParsedFile): JsxUsage[];
  /** Resolves any version of a file (a base version too) the way `usages` does, imports and global registrations included; not cached. */
  usagesOf(file: ParsedFile): JsxUsage[];
  /** The stylesheet rules whose selectors use a class: the project's stylesheets and component style blocks. */
  styledBy(className: string): StyleRule[];
  /** Whether the project uses Tailwind: a `tailwindcss` dependency, or a stylesheet that imports it or has `@tailwind` or `@theme`. */
  usesTailwind(): boolean;
  definitions(file: ParsedFile): ComponentDefinition[];
  changes?: ChangeSet;
  readBase?: (file: string) => Promise<string | null>;
  /** Computed for changed component definitions when a change set is present. */
  provenance: ProvenanceRecord[];
}

export interface FileCheckContext<O> {
  ruleId: string;
  options: O;
  file: ParsedFile;
  project: SourceProject;
}

export interface ProjectCheckContext<O> {
  ruleId: string;
  options: O;
  project: SourceProject;
  /** Files in this rule's scope that the change set touches (all scoped files on a full scan). */
  targets: ParsedFile[];
}

export interface SourceCheck<S extends z.ZodType = z.ZodType> extends CheckDefinition {
  engine: 'source';
  options: S;
  runFile?(ctx: FileCheckContext<z.output<S>>): FindingDraft[];
  runProject?(ctx: ProjectCheckContext<z.output<S>>): Promise<FindingDraft[]>;
}

/** Identity helper that keeps option types inferred from the schema. */
export const defineCheck = <S extends z.ZodType>(c: SourceCheck<S>): SourceCheck<S> => c;

/** A deterministic, high-confidence draft located in the current file, with the source line as evidence. */
export function fileFinding(
  ctx: FileCheckContext<unknown>,
  check: string,
  at: { line: number; column?: number; endLine?: number },
  d: Pick<FindingDraft, 'message' | 'verdict'> & Partial<FindingDraft>,
): FindingDraft {
  return {
    ruleId: ctx.ruleId,
    check,
    confidence: 'high',
    origin: 'deterministic',
    engine: 'source',
    location: { file: ctx.file.path, ...at },
    evidence: [{ kind: 'code', file: ctx.file.path, line: at.line, snippet: snippetAt(ctx.file, at.line) }],
    ...(at.endLine && at.endLine > at.line && { spanText: ctx.file.lines.slice(at.line - 1, at.endLine).join('\n') }),
    ...d,
  };
}
