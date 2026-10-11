import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { resolveInside, type Box, type CheckDefinition, type Evidence, type FindingDraft, type VisualDiffSummary } from '@design-warden/core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { MANIFEST_FILE, manifestSchema, type CaptureEntry, type CaptureManifest } from './manifest.ts';
import { changedRegions } from './regions.ts';

const options = z.strictObject({
  // pixelmatch 8 OKLab threshold. 0.1 (the default) misses adjacent token shades; see docs/research/visual-regression.md.
  threshold: z.number().min(0).max(1).default(0.02),
  cellSize: z.int().positive().default(8),
  minCellPixels: z.int().positive().default(4),
  minRegionPixels: z.int().positive().default(24),
});
export type VisualDiffOptions = z.output<typeof options>;

export const visualDiffCheck: CheckDefinition = {
  id: 'visual-diff',
  engine: 'visual',
  description: 'Compares base and head captures of the configured routes and states and reports changed regions for review.',
  options,
};

export class VisualError extends Error {
  override name = 'VisualError';
}

export function readManifest(dir: string): CaptureManifest {
  const file = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(file)) throw new VisualError(`no capture manifest in ${dir}; run "design-warden capture" first`);
  const parsed = manifestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new VisualError(`invalid capture manifest ${file}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export interface CompareInput {
  baseDir: string;
  headDir: string;
  /** Diff images are written here; report paths are relative to it. */
  artifactDir: string;
  ruleId: string;
  options: VisualDiffOptions;
  /** Stylesheet rules that likely style an element (`a.ds-link`), most relevant first; the caller knows the source. */
  styleHints?: (label: string) => StyleHint[];
}

/** A stylesheet rule named as a likely source of a visual change: a heuristic, by the element's class. */
export interface StyleHint {
  file: string;
  line: number;
  selector: string;
  /** The file is part of the change. */
  changed: boolean;
}

/** Both manifests, refusing captures from different environments: their pixels and rendered styles differ. */
export function readCapturePair(baseDir: string, headDir: string): { base: CaptureManifest; head: CaptureManifest } {
  const base = readManifest(baseDir);
  const head = readManifest(headDir);
  const fa = JSON.stringify(base.fingerprint);
  const fb = JSON.stringify(head.fingerprint);
  if (fa !== fb) {
    throw new VisualError(
      `refusing to compare captures from different environments: base ${fa} vs head ${fb}. ` +
        'Capture both with the same Playwright version, browser, platform and scale, for example in the pinned CI container (docs/ci-integration.md, "Committed baselines").',
    );
  }
  return { base, head };
}

/** Async only to yield between captures: each pair is CPU-bound, and a server running this (the inspector) must keep answering. */
export async function compareCaptures(input: CompareInput): Promise<{ drafts: FindingDraft[]; diffs: VisualDiffSummary[] }> {
  const { base, head } = readCapturePair(input.baseDir, input.headDir);

  const baseById = new Map(base.captures.map((c) => [c.id, c]));
  const diffs: VisualDiffSummary[] = [];
  for (const h of head.captures) {
    await yieldToEventLoop();
    diffs.push(compareOne(baseById.get(h.id), h, input));
  }
  for (const b of base.captures) {
    if (!head.captures.some((h) => h.id === b.id)) diffs.push(summary(b, 'removed', { changedPixels: 0, changedRatio: 0, regions: [] }));
  }
  return { drafts: toDrafts(diffs, input.ruleId, input.styleHints), diffs };
}

function summary(c: CaptureEntry, status: VisualDiffSummary['status'], d: Pick<VisualDiffSummary, 'changedPixels' | 'changedRatio' | 'regions'>, extra: Partial<VisualDiffSummary> = {}): VisualDiffSummary {
  return { capture: c.id, route: c.route, state: c.state, viewport: c.viewport, status, ...d, images: {}, ...extra };
}

const empty = { changedPixels: 0, changedRatio: 0, regions: [] as Box[] };

function compareOne(b: CaptureEntry | undefined, h: CaptureEntry, input: CompareInput): VisualDiffSummary {
  if (h.error || !h.file) return summary(h, 'error', empty, { error: `head capture failed: ${h.error ?? 'no image'}` });
  if (!b) return summary(h, 'added', empty);
  if (b.error || !b.file) return summary(h, 'error', empty, { error: `base capture failed: ${b.error ?? 'no image'}` });

  const before = PNG.sync.read(fs.readFileSync(resolveInside(input.baseDir, b.file)));
  const after = PNG.sync.read(fs.readFileSync(resolveInside(input.headDir, h.file)));
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const [a1, a2] = [pad(before, width, height), pad(after, width, height)];
  const out = new Uint8Array(width * height * 4);
  pixelmatch(a1, a2, out, width, height, { threshold: input.options.threshold, diffMask: true });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = out[i * 4 + 3]! > 0 ? 1 : 0;
  const { regions, pixels } = changedRegions(mask, width, height, input.options);
  const sizeChanged = before.width !== after.width || before.height !== after.height;
  if (!regions.length && !sizeChanged) return summary(h, 'unchanged', { changedPixels: pixels, changedRatio: pixels / (width * height), regions: [] });

  const dirName = h.id.replace(/[^a-z0-9-]+/gi, '__');
  const dir = path.join(input.artifactDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'before.png'), PNG.sync.write(before));
  fs.writeFileSync(path.join(dir, 'after.png'), PNG.sync.write(after));
  fs.writeFileSync(path.join(dir, 'diff.png'), PNG.sync.write(overlay(a2, mask, width, height)));
  return summary(
    h,
    sizeChanged ? 'size-changed' : 'changed',
    { changedPixels: pixels, changedRatio: pixels / (width * height), regions: regions.map((r) => ({ ...r, label: nearestElement(h, r) })) },
    { images: { before: `${dirName}/before.png`, after: `${dirName}/after.png`, diff: `${dirName}/diff.png` } },
  );
}

/** Pads an image to the given size; the padding is magenta so added or removed area always counts as changed. */
function pad(png: PNG, width: number, height: number): Uint8Array {
  if (png.width === width && png.height === height) return png.data;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set([255, 0, 255, 255], i * 4);
  for (let y = 0; y < png.height; y++) out.set(png.data.subarray(y * png.width * 4, (y + 1) * png.width * 4), y * width * 4);
  return out;
}

/** Faded head image with changed pixels in red. */
function overlay(head: Uint8Array, mask: Uint8Array, width: number, height: number): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (mask[i]) png.data.set([230, 0, 40, 255], o);
    else {
      const gray = 255 - (255 - (0.3 * head[o]! + 0.59 * head[o + 1]! + 0.11 * head[o + 2]!)) * 0.25;
      png.data.set([gray, gray, gray, 255], o);
    }
  }
  return png;
}

/** Smallest captured element containing the region's centre, for a human-readable location. */
function nearestElement(c: CaptureEntry, r: Box): string | undefined {
  const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
  let best: { label: string; area: number } | undefined;
  for (const e of c.elements ?? []) {
    const b = e.box;
    if (cx < b.x || cy < b.y || cx > b.x + b.width || cy > b.y + b.height) continue;
    const area = b.width * b.height;
    if (!best || area < best.area) best = { label: e.label, area };
  }
  return best?.label;
}

function toDrafts(diffs: VisualDiffSummary[], ruleId: string, styleHints?: CompareInput['styleHints']): FindingDraft[] {
  const groups = new Map<string, VisualDiffSummary[]>();
  for (const d of diffs) {
    if (d.status === 'unchanged') continue;
    const key = `${d.route}/${d.state}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const drafts: FindingDraft[] = [];
  for (const [key, ds] of groups) {
    const errors = ds.filter((d) => d.status === 'error');
    const changed = ds.filter((d) => d.status === 'changed' || d.status === 'size-changed');
    const evidence: Evidence[] = ds.map((d) => ({
      kind: 'screenshot',
      capture: d.capture,
      region: d.regions[0],
      before: d.images.before,
      after: d.images.after,
      diff: d.images.diff,
    }));
    const base = { ruleId, check: 'visual-diff', origin: 'deterministic' as const, engine: 'visual' as const, evidence };
    if (errors.length) {
      drafts.push({ ...base, verdict: 'insufficient-evidence', confidence: 'high', message: `Could not compare ${key}: ${errors.map((e) => `${e.viewport}: ${e.error}`).join('; ')}.` });
    }
    if (changed.length) {
      const where = changed[0]!.regions[0]?.label;
      const hints = where && styleHints ? styleHints(where).slice(0, 3) : [];
      drafts.push({
        ...base,
        evidence: [...evidence, ...hints.map((h) => ({ kind: 'code' as const, file: h.file, line: h.line, snippet: h.selector }))],
        verdict: 'insufficient-evidence',
        confidence: 'high',
        message:
          `Rendered output of ${key} changed (${changed.map((d) => `${d.viewport}: ${d.regions.length} region(s), ${(d.changedRatio * 100).toFixed(2)}% of pixels`).join('; ')}).` +
          `${where ? ` Largest change near \`${where}\`.` : ''}` +
          `${hints.length ? ` Likely styled by (heuristic): ${hints.map((h) => `${h.file}:${h.line} \`${h.selector}\`${h.changed ? ' (changed)' : ''}`).join('; ')}.` : ''}` +
          ' A difference is not a violation; confirm it is intended.',
      });
    }
    const added = ds.filter((d) => d.status === 'added' || d.status === 'removed');
    if (added.length) {
      drafts.push({ ...base, verdict: 'notice', confidence: 'high', message: `${key}: ${added.map((d) => `${d.viewport} ${d.status}`).join(', ')} (no counterpart to compare).` });
    }
  }
  return drafts;
}
