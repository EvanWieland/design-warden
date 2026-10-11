import { z } from 'zod';

const box = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/**
 * Written by `design-warden capture` next to the screenshots, and validated before any comparison,
 * because capture directories can come from CI artifacts. Types are inferred from this schema.
 */
export const manifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  /** Everything that changes pixels for the same page. Captures are only compared when these match. */
  fingerprint: z.strictObject({
    playwright: z.string(),
    browser: z.string(),
    headless: z.boolean(),
    platform: z.string(),
    deviceScaleFactor: z.number(),
  }),
  baseUrl: z.string(),
  /** How axe-core ran, when the policy has an accessibility rule. Results are compared only when these match. */
  axe: z.strictObject({ version: z.string(), tags: z.array(z.string()) }).optional(),
  captures: z.array(
    z.strictObject({
      id: z.string(), // route/state/viewport
      route: z.string(),
      state: z.string(),
      viewport: z.string(),
      url: z.string(),
      file: z.string().optional(), // PNG, relative to the manifest
      /** Labelled boxes of up to 1,500 elements, e.g. `table.ds-table`, used to name changed regions. */
      elements: z.array(z.strictObject({ label: z.string(), box })).optional(),
      error: z.string().optional(),
      /** axe-core violations in this state (up to 25 elements each, with axe's selector and the element's HTML). */
      accessibility: z
        .array(
          z.strictObject({
            rule: z.string(),
            impact: z.string().nullable(),
            help: z.string(),
            helpUrl: z.string(),
            nodes: z.array(z.strictObject({ target: z.string(), html: z.string() })),
          }),
        )
        .optional(),
      accessibilityError: z.string().optional(),
    }),
  ),
});

export type CaptureManifest = z.infer<typeof manifestSchema>;
export type Fingerprint = CaptureManifest['fingerprint'];
export type CaptureEntry = CaptureManifest['captures'][number];
export type CapturedElement = NonNullable<CaptureEntry['elements']>[number];

export const MANIFEST_FILE = 'manifest.json';
