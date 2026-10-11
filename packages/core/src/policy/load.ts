import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PathError, resolveInside } from '../paths.ts';
import { policySchema, type Policy } from './schema.ts';

const MAX_POLICY_BYTES = 1024 * 1024;

export class PolicyError extends Error {
  override name = 'PolicyError';
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(issues.length ? `${message}\n${issues.map((i) => `  - ${i}`).join('\n')}` : message);
    this.issues = issues;
  }
}

/** A check an engine provides; used to validate `verify.check` and its options at load time. */
export interface CheckDefinition {
  id: string;
  engine: 'source' | 'visual';
  description: string;
  options: z.ZodType;
}

export interface LoadedPolicy {
  policy: Policy;
  /** Absolute project root: the directory containing the policy file. */
  root: string;
  /** Policy path relative to the root (normally just the file name). */
  path: string;
  sha256: string;
  /** "working-tree" or "git:<ref>" */
  source: string;
  /** Check options after parsing with each check's schema (defaults applied), keyed by rule id. */
  checkOptions: Map<string, unknown>;
}

/** Parses and validates policy text. Throws PolicyError with one line per problem. */
export function parsePolicy(
  text: string,
  opts: { root: string; path: string; source: string; checks: readonly CheckDefinition[] },
): LoadedPolicy {
  if (Buffer.byteLength(text) > MAX_POLICY_BYTES) throw new PolicyError('policy file is larger than 1 MiB');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new PolicyError(`policy is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = policySchema.safeParse(json);
  if (!parsed.success) {
    throw new PolicyError(
      'policy failed validation:',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const policy = parsed.data;
  const issues: string[] = [];
  const checkOptions = new Map<string, unknown>();
  const checks = new Map(opts.checks.map((c) => [c.id, c]));

  policy.rules.forEach((r, i) => {
    if (r.verify.by !== 'check') return;
    const check = checks.get(r.verify.check);
    if (!check) {
      issues.push(`rules.${i}.verify.check: unknown check "${r.verify.check}" (known: ${[...checks.keys()].join(', ')})`);
      return;
    }
    const o = check.options.safeParse(r.verify.options ?? {});
    if (o.success) checkOptions.set(r.id, o.data);
    else for (const issue of o.error.issues) issues.push(`rules.${i}.verify.options.${issue.path.join('.')}: ${issue.message}`);
  });

  // Every referenced file must exist inside the project root.
  const files: [string, string][] = [
    ...policy.tokens.sources.map((p, i) => [`tokens.sources.${i}`, p] as [string, string]),
    ...policy.components.map((c, i) => [`components.${i}.source`, c.source] as [string, string]),
    ...policy.patterns.map((p, i) => [`patterns.${i}.reference`, p.reference] as [string, string]),
    ...Object.entries(policy.guidance).flatMap(([k, g]) => (g.path ? [[`guidance.${k}.path`, g.path] as [string, string]] : [])),
  ];
  for (const [where, rel] of files) {
    try {
      if (!fs.existsSync(resolveInside(opts.root, rel))) issues.push(`${where}: file not found: ${rel}`);
    } catch (err) {
      if (err instanceof PathError) issues.push(`${where}: ${err.message}`);
      else throw err;
    }
  }
  if (issues.length) throw new PolicyError('policy failed validation:', issues);

  return {
    policy,
    root: opts.root,
    path: opts.path,
    sha256: createHash('sha256').update(text).digest('hex'),
    source: opts.source,
    checkOptions,
  };
}

export function loadPolicyFile(policyPath: string, checks: readonly CheckDefinition[]): LoadedPolicy {
  const abs = path.resolve(policyPath);
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    throw new PolicyError(`cannot read policy file ${policyPath}: ${(err as Error).message}`);
  }
  return parsePolicy(text, { root: path.dirname(abs), path: path.basename(abs), source: 'working-tree', checks });
}

/** JSON Schema for editor completion (`"$schema"` in policy files). */
export const policyJsonSchema = () => z.toJSONSchema(policySchema, { io: 'input', unrepresentable: 'any' });
