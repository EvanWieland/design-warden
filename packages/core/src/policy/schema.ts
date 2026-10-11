import { z } from 'zod';

/**
 * Design Warden policy file format, version 1.
 *
 * The policy is data only: it can select built-in checks and configure them, but it
 * can never name a script, command, module path or URL to execute (ADR 0004).
 * Every path in it is resolved inside the directory that contains the policy file.
 */

export const RULE_CATEGORIES = ['mandatory', 'required-pattern', 'preferred', 'advisory'] as const;
export const SEVERITIES = ['error', 'warning', 'info'] as const;
export const ENFORCEMENTS = ['block', 'review', 'report'] as const;
export const FAILURE_MODES = ['fail-closed', 'review', 'fail-open'] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Enforcement = (typeof ENFORCEMENTS)[number];
export type FailureMode = (typeof FAILURE_MODES)[number];

/** What a category implies when a rule does not say otherwise. */
export const CATEGORY_DEFAULTS: Record<RuleCategory, { severity: Severity; enforcement: Enforcement; inlineExceptions: boolean }> = {
  mandatory: { severity: 'error', enforcement: 'block', inlineExceptions: false },
  'required-pattern': { severity: 'error', enforcement: 'block', inlineExceptions: false },
  preferred: { severity: 'warning', enforcement: 'review', inlineExceptions: true },
  advisory: { severity: 'info', enforcement: 'report', inlineExceptions: true },
};

const id = z
  .string()
  .regex(/^[a-z0-9]+(?:[-./][a-z0-9]+)*$/, 'use lowercase letters, digits and - . / separators');
const relPath = z.string().min(1).describe('Path relative to the directory containing the policy file.');
const glob = z.string().min(1).describe('Glob relative to the project root, e.g. "src/**/*.tsx".');

const guidanceEntry = z
  .strictObject({
    title: z.string().min(1),
    path: relPath.optional().describe('Repository file holding the guidance (for example a design skill page).'),
    section: z.string().optional().describe('Heading inside the file that the reference points at.'),
    url: z
      .url({ protocol: /^https?$/ })
      .optional()
      .describe('External documentation URL (http or https). Shown as a link; never fetched.'),
  })
  .refine((g) => g.path !== undefined || g.url !== undefined, 'guidance needs a path or a url');

const example = z.strictObject({
  file: relPath.describe('Virtual file name; its extension selects the parser and it is matched against the rule scope.'),
  code: z.string(),
  expect: z.enum(['pass', 'fail']),
  note: z.string().optional(),
});

const verify = z.discriminatedUnion('by', [
  z.strictObject({
    by: z.literal('check'),
    check: id.describe('Built-in deterministic check that verifies this rule.'),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({ by: z.literal('semantic').describe('Judged by the optional semantic reviewer; can never block.') }),
  z.strictObject({ by: z.literal('manual').describe('Documented only; given to reviewers as context.') }),
]);

const rule = z.strictObject({
  id,
  version: z.int().positive().describe('Bump when the meaning of the rule changes.'),
  title: z.string().min(1),
  category: z.enum(RULE_CATEGORIES),
  severity: z.enum(SEVERITIES).optional().describe('Defaults from the category.'),
  enforcement: z.enum(ENFORCEMENTS).optional().describe('What a confirmed violation does in CI. Defaults from the category.'),
  description: z.string().min(1),
  rationale: z.string().min(1),
  verify,
  scope: z
    .strictObject({ include: z.array(glob).optional(), exclude: z.array(glob).optional() })
    .optional()
    .describe('Narrows the project include/exclude for this rule.'),
  guidance: z.array(z.string()).default([]).describe('Keys of entries in the top-level guidance map.'),
  remediation: z.string().min(1),
  examples: z.array(example).default([]).describe('Executable examples, run by `design-warden policy test`.'),
  inlineExceptions: z
    .boolean()
    .optional()
    .describe('Whether design-warden-ignore comments may suppress this rule. Defaults to false for mandatory and required-pattern rules.'),
});

const propContract = z.strictObject({
  allowed: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  required: z.boolean().optional(),
});

const component = z.strictObject({
  name: z.string().min(1).describe('Exported component name, e.g. "Button".'),
  source: relPath.describe('File that implements the component.'),
  replaces: z
    .array(z.string().regex(/^(?=.)([a-z][a-z0-9-]*)?(\[[a-z-]+=[^\]]+\])?$/, 'use "tag", "tag[attr=value]" or "[attr=value]"'))
    .default([])
    .describe('Raw elements this component supersedes: "button", "input[type=checkbox]", or an ARIA imitation such as "[role=button]".'),
  aliases: z.array(z.string()).default([]).describe('Name fragments that suggest a re-implementation, e.g. ["pill", "chip"].'),
  props: z.record(z.string(), propContract).default({}).describe('Prop contract checked at call sites.'),
  guidance: z.array(z.string()).default([]),
});

const pattern = z.strictObject({
  id,
  name: z.string().min(1),
  reference: relPath.describe('Reference implementation of the pattern.'),
  description: z.string().min(1),
  guidance: z.array(z.string()).default([]),
});

const exception = z.strictObject({
  id,
  rules: z.array(id).min(1).describe('Rules this exception applies to. Wildcards are not allowed.'),
  paths: z.array(glob).min(1),
  reason: z.string().min(10),
  approvedBy: z.string().optional(),
  expires: z.iso.date().optional().describe('YYYY-MM-DD. After this date the exception stops applying.'),
});

/** An owner accepted one review request (ADR 0012). Read from wherever the policy is read: the base ref in CI. */
const approval = z.strictObject({
  fingerprint: z.string().regex(/^[0-9a-f]{16}(-\d+)?$/).describe('The finding id from the JSON report (partialFingerprints in SARIF).'),
  rule: id,
  file: relPath.optional().describe('Omitted for findings without a location, such as visual changes.'),
  reason: z.string().min(10),
  approvedBy: z.string().min(1),
  expires: z.iso.date().describe('YYYY-MM-DD. Required, so acceptances are re-examined.'),
});

const action = z.union([
  z.strictObject({ click: z.string().min(1) }),
  z.strictObject({ hover: z.string().min(1) }),
  z.strictObject({ focus: z.string().min(1) }),
  z.strictObject({ fill: z.string().min(1), value: z.string() }),
  z.strictObject({ press: z.string().min(1), key: z.string().min(1) }),
]);

const visual = z.strictObject({
  viewports: z.array(z.strictObject({ id, width: z.int().positive(), height: z.int().positive() })).min(1),
  routes: z
    .array(
      z.strictObject({
        id,
        path: z.string().startsWith('/'),
        states: z
          .array(
            z.strictObject({
              id,
              query: z.string().optional().describe('Query string appended to the route, without "?".'),
              actions: z.array(action).default([]).describe('Limited, declarative interactions. No scripts.'),
              waitFor: z.string().optional().describe('CSS selector that must be visible before capture.'),
            }),
          )
          .default([{ id: 'default', actions: [] }]),
      }),
    )
    .min(1),
  mask: z.array(z.string()).default([]).describe('CSS selectors painted over before comparison (volatile content).'),
});

const semanticReview = z.strictObject({
  enabled: z.boolean().default(false).describe('Allows semantic review. A provider must still be configured in the environment.'),
  maxFiles: z.int().positive().default(12),
  maxFileChars: z.int().positive().default(20000),
  includeScreenshots: z.boolean().default(false),
  guidance: z.array(z.string()).default([]).describe('Guidance entries always sent as context.'),
});

export const policySchema = z
  .strictObject({
    $schema: z.string().optional(),
    policyVersion: z.literal(1),
    name: z.string().min(1),
    revision: z.string().min(1).describe('Content revision of this policy, e.g. "2026.10.1".'),
    owners: z.array(z.string()).default([]),
    project: z.strictObject({
      include: z.array(glob).min(1),
      exclude: z.array(glob).default([]),
    }),
    designSystem: z.strictObject({
      paths: z.array(glob).min(1).describe('Files that implement the design system itself.'),
      importSources: z
        .array(z.string().min(1))
        .min(1)
        .describe('Module specifiers or project paths that count as design-system imports.'),
    }),
    tokens: z.strictObject({
      sources: z.array(relPath).min(1).describe('Token files: CSS that defines tokens as custom properties, or DTCG *.tokens.json files (names derived as --group-token).'),
      allowedPrefixes: z
        .array(z.string().startsWith('--'))
        .min(1)
        .describe('Token prefixes application code may reference; other defined tokens are internal.'),
    }),
    components: z.array(component).default([]),
    patterns: z.array(pattern).default([]),
    guidance: z.record(id, guidanceEntry).default({}),
    rules: z.array(rule).min(1),
    exceptions: z.array(exception).default([]),
    approvals: z.array(approval).default([]).describe('Accepted review requests. They can clear review findings only, never blocking ones.'),
    visual: visual.optional(),
    semanticReview: semanticReview.optional(),
    failurePolicy: z
      .strictObject({
        source: z.enum(FAILURE_MODES).default('fail-closed'),
        visual: z.enum(FAILURE_MODES).default('review'),
        semantic: z.enum(FAILURE_MODES).default('review'),
      })
      .default({ source: 'fail-closed', visual: 'review', semantic: 'review' })
      .describe('What happens when a configured engine cannot complete.'),
  })
  .superRefine((p, ctx) => {
    const dup = (values: string[], what: string, path: (string | number)[]) => {
      const seen = new Set<string>();
      values.forEach((v, i) => {
        if (seen.has(v)) ctx.addIssue({ code: 'custom', message: `duplicate ${what} "${v}"`, path: [...path, i] });
        seen.add(v);
      });
    };
    dup(p.rules.map((r) => r.id), 'rule id', ['rules']);
    dup(p.components.map((c) => c.name), 'component name', ['components']);
    dup(p.patterns.map((x) => x.id), 'pattern id', ['patterns']);
    dup(p.exceptions.map((x) => x.id), 'exception id', ['exceptions']);

    const ruleIds = new Set(p.rules.map((r) => r.id));
    const checkGuidance = (keys: string[], path: (string | number)[]) =>
      keys.forEach((k, i) => {
        if (!(k in p.guidance)) ctx.addIssue({ code: 'custom', message: `unknown guidance "${k}"`, path: [...path, i] });
      });

    p.rules.forEach((r, i) => {
      checkGuidance(r.guidance, ['rules', i, 'guidance']);
      // Trust model: a model's judgement may request review but never block a merge (ADR 0001).
      if (r.verify.by === 'semantic' && (r.enforcement ?? CATEGORY_DEFAULTS[r.category].enforcement) === 'block') {
        ctx.addIssue({
          code: 'custom',
          message: 'rules verified by semantic review cannot use enforcement "block"; use "review" or "report"',
          path: ['rules', i, 'enforcement'],
        });
      }
    });
    p.components.forEach((c, i) => checkGuidance(c.guidance, ['components', i, 'guidance']));
    p.patterns.forEach((x, i) => checkGuidance(x.guidance, ['patterns', i, 'guidance']));
    checkGuidance(p.semanticReview?.guidance ?? [], ['semanticReview', 'guidance']);
    p.exceptions.forEach((x, i) =>
      x.rules.forEach((r, j) => {
        if (!ruleIds.has(r)) ctx.addIssue({ code: 'custom', message: `unknown rule "${r}"`, path: ['exceptions', i, 'rules', j] });
      }),
    );
    const approved = new Set<string>();
    p.approvals.forEach((a, i) => {
      if (!ruleIds.has(a.rule)) ctx.addIssue({ code: 'custom', message: `unknown rule "${a.rule}"`, path: ['approvals', i, 'rule'] });
      if (approved.has(a.fingerprint)) ctx.addIssue({ code: 'custom', message: `duplicate approval for ${a.fingerprint}`, path: ['approvals', i, 'fingerprint'] });
      approved.add(a.fingerprint);
    });
  });

export type Policy = z.infer<typeof policySchema>;
export type PolicyRule = Policy['rules'][number];
export type ComponentSpec = Policy['components'][number];
export type PatternSpec = Policy['patterns'][number];
export type GuidanceEntry = Policy['guidance'][string];
export type PolicyException = Policy['exceptions'][number];
export type PolicyApproval = Policy['approvals'][number];
export type VisualConfig = NonNullable<Policy['visual']>;
export type VisualAction = VisualConfig['routes'][number]['states'][number]['actions'][number];
export type SemanticReviewConfig = NonNullable<Policy['semanticReview']>;
