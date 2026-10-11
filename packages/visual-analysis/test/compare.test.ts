import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { accessibilityDrafts, changedRegions, compareCaptures, type CaptureManifest } from '../src/index.ts';

const OPTS = { threshold: 0.02, cellSize: 8, minCellPixels: 4, minRegionPixels: 24 };

describe('changedRegions', () => {
  it('finds separate blobs and ignores scattered noise', () => {
    const [w, h] = [100, 100];
    const mask = new Uint8Array(w * h);
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
    };
    fill(10, 10, 20, 20);
    fill(60, 70, 80, 75);
    for (let i = 0; i < 40; i++) mask[((i * 97) % h) * w + ((i * 53) % w)] = 1; // isolated noise pixels
    const { regions } = changedRegions(mask, w, h, OPTS);
    expect(regions).toEqual([
      { x: 8, y: 8, width: 16, height: 16 },
      { x: 56, y: 64, width: 24, height: 16 },
    ]);
  });
});

/** Writes a capture directory with solid-colour images, optionally with a coloured block. */
function captureDir(name: string, color: [number, number, number], block?: { color: [number, number, number]; x: number; y: number; size: number }, opts: { height?: number; fingerprint?: object } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dw-cap-${name}-`));
  const [w, h] = [200, opts.height ?? 120];
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBlock = block && x >= block.x && x < block.x + block.size && y >= block.y && y < block.y + block.size;
      png.data.set([...(inBlock ? block!.color : color), 255], (y * w + x) * 4);
    }
  }
  fs.writeFileSync(path.join(dir, 'home__default__desktop.png'), PNG.sync.write(png));
  const manifest: CaptureManifest = {
    manifestVersion: 1,
    fingerprint: { playwright: '1.64.0', browser: 'chromium 1', headless: true, platform: 'test', deviceScaleFactor: 1, ...opts.fingerprint },
    baseUrl: 'http://127.0.0.1:1',
    captures: [
      { id: 'home/default/desktop', route: 'home', state: 'default', viewport: 'desktop', url: 'x', file: 'home__default__desktop.png', elements: [{ label: 'section.ds-card', box: { x: 40, y: 20, width: 80, height: 60 } }] },
      { id: 'home/broken/desktop', route: 'home', state: 'broken', viewport: 'desktop', url: 'x', error: 'waiting for selector "table" failed' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

const compare = (baseDir: string, headDir: string) =>
  compareCaptures({ baseDir, headDir, artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dw-art-')), ruleId: 'visual/changes', options: OPTS });

describe('compareCaptures', () => {
  const white: [number, number, number] = [255, 255, 255];
  const blue600: [number, number, number] = [37, 99, 235];
  const blue700: [number, number, number] = [29, 78, 216];

  it('reports identical captures as unchanged and failed captures as insufficient evidence', async () => {
    const { diffs, drafts } = await compare(captureDir('a', white), captureDir('b', white));
    expect(diffs.find((d) => d.state === 'default')?.status).toBe('unchanged');
    expect(drafts).toEqual([expect.objectContaining({ verdict: 'insufficient-evidence', message: expect.stringMatching(/Could not compare home\/broken/) })]);
  });

  it('detects an adjacent-shade token change (blue-600 -> blue-700) and localises it', async () => {
    const block = { x: 50, y: 30, size: 40 };
    const { diffs, drafts } = await compare(captureDir('a', white, { ...block, color: blue600 }), captureDir('b', white, { ...block, color: blue700 }));
    const d = diffs.find((x) => x.state === 'default')!;
    expect(d.status).toBe('changed');
    expect(d.regions).toEqual([{ x: 48, y: 24, width: 48, height: 48, label: 'section.ds-card' }]);
    expect(d.images).toEqual({ before: 'home__default__desktop/before.png', after: 'home__default__desktop/after.png', diff: 'home__default__desktop/diff.png' });
    const changed = drafts.find((x) => x.message.startsWith('Rendered output of home/default changed'));
    expect(changed).toMatchObject({ verdict: 'insufficient-evidence', origin: 'deterministic', engine: 'visual' });
    expect(changed!.message).toContain('Largest change near `section.ds-card`');
  });

  it('names the stylesheet rules the caller finds for the largest change, as a heuristic, changed files marked', async () => {
    const block = { x: 50, y: 30, size: 40 };
    const asked: string[] = [];
    const styleHints = (label: string) => {
      asked.push(label);
      return [
        { file: 'src/ds/Card.css', line: 3, selector: '.ds-card', changed: false },
        { file: 'src/ds/Accent.css', line: 9, selector: '.ds-card--accent', changed: true },
        { file: 'src/a.css', line: 1, selector: '.ds-card', changed: false },
        { file: 'src/b.css', line: 1, selector: '.ds-card', changed: false },
      ];
    };
    const { drafts } = await compareCaptures({
      baseDir: captureDir('a', white, { ...block, color: blue600 }),
      headDir: captureDir('b', white, { ...block, color: blue700 }),
      artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dw-art-')),
      ruleId: 'visual/changes',
      options: OPTS,
      styleHints,
    });
    const changed = drafts.find((x) => x.message.startsWith('Rendered output of home/default changed'))!;
    expect(asked).toEqual(['section.ds-card']);
    expect(changed.message).toContain(
      'Likely styled by (heuristic): src/ds/Card.css:3 `.ds-card`; src/ds/Accent.css:9 `.ds-card--accent` (changed); src/a.css:1 `.ds-card`.',
    );
    expect(changed.evidence?.filter((e) => e.kind === 'code')).toEqual([
      { kind: 'code', file: 'src/ds/Card.css', line: 3, snippet: '.ds-card' },
      { kind: 'code', file: 'src/ds/Accent.css', line: 9, snippet: '.ds-card--accent' },
      { kind: 'code', file: 'src/a.css', line: 1, snippet: '.ds-card' },
    ]);
  });

  it('reports a page that grew as size-changed', async () => {
    const { diffs } = await compare(captureDir('a', white), captureDir('b', white, undefined, { height: 160 }));
    expect(diffs.find((d) => d.state === 'default')?.status).toBe('size-changed');
  });

  it('yields to the event loop while comparing, so a server running it stays responsive', async () => {
    let turned = false;
    setImmediate(() => (turned = true));
    await compare(captureDir('a', white), captureDir('b', white));
    expect(turned).toBe(true);
  });

  it('refuses to compare captures from different environments', async () => {
    await expect(compare(captureDir('a', white), captureDir('b', white, undefined, { fingerprint: { platform: 'other' } }))).rejects.toThrow(/different environments/);
  });

  it('rejects a manifest that points outside its directory', async () => {
    const base = captureDir('a', white);
    const head = captureDir('b', white);
    const m = JSON.parse(fs.readFileSync(path.join(head, 'manifest.json'), 'utf8')) as CaptureManifest;
    m.captures[0]!.file = '../../etc/passwd';
    fs.writeFileSync(path.join(head, 'manifest.json'), JSON.stringify(m));
    await expect(compare(base, head)).rejects.toThrow(/escapes the project root/);
  });
});

describe('accessibilityDrafts', () => {
  const node = (target: string, html = `<b class="${target.slice(1)}">x</b>`) => ({ target, html });
  const v = (rule: string, nodes: ReturnType<typeof node>[]) => ({ rule, impact: 'serious', help: `${rule} help`, helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${rule}`, nodes });
  const AXE = { version: '4.14.0', tags: ['wcag2a'] };
  // `axe: null` makes a manifest captured without axe-core.
  const manifest = (accessibility?: ReturnType<typeof v>[], accessibilityError?: string, axe: CaptureManifest['axe'] | null = AXE): CaptureManifest => ({
    manifestVersion: 1,
    fingerprint: { playwright: '1.64.0', browser: 'chromium 1', headless: true, platform: 'test', deviceScaleFactor: 1 },
    baseUrl: 'http://127.0.0.1:1',
    ...(axe && { axe }),
    captures: [{ id: 'home/default/desktop', route: 'home', state: 'default', viewport: 'desktop', url: 'x', file: 'a.png', accessibility, accessibilityError }],
  });

  it('reports only violations that are new in head, per rule, as probable violations for review', () => {
    const drafts = accessibilityDrafts(manifest([v('html-has-lang', [node('html')])]), manifest([v('html-has-lang', [node('html')]), v('color-contrast', [node('.badge'), node('.btn')])]), 'a11y/axe');
    expect(drafts).toEqual([
      expect.objectContaining({
        ruleId: 'a11y/axe',
        check: 'accessibility',
        verdict: 'probable-violation',
        origin: 'deterministic',
        engine: 'visual',
        message: 'color-contrast (serious) on home/default (desktop): color-contrast help. New on 2 element(s): `.badge`, `.btn`.',
        evidence: [{ kind: 'note', text: 'axe-core rule color-contrast: https://dequeuniversity.com/rules/axe/4.14/color-contrast' }],
      }),
    ]);
  });

  it('matches elements by their HTML, not by positional selectors: a moved violation is not new, a second identical one is', () => {
    const late = '<span class="badge">Late</span>';
    const drafts = accessibilityDrafts(
      manifest([v('color-contrast', [node('li:nth-child(2) > .badge', late)])]),
      manifest([v('color-contrast', [node('li:nth-child(3) > .badge', late), node('li:nth-child(4) > .badge', late)])]),
      'a11y/axe',
    );
    expect(drafts.map((d) => d.message)).toEqual(['color-contrast (serious) on home/default (desktop): color-contrast help. New on 1 element(s): `li:nth-child(4) > .badge`.']);
  });

  it('does not compare results from another axe-core version or other tags, and reports captures made without axe', () => {
    const newer = accessibilityDrafts(manifest([]), manifest([v('color-contrast', [node('.btn')])], undefined, { version: '4.15.0', tags: ['wcag2a'] }), 'a11y/axe');
    expect(newer.map((d) => [d.verdict, d.message])).toEqual([
      ['insufficient-evidence', 'Accessibility results were not compared: base was captured with axe-core 4.14.0 (wcag2a), head with axe-core 4.15.0 (wcag2a). Capture both with the same tags and axe-core version.'],
    ]);
    const oldBaseline = accessibilityDrafts(manifest(undefined, undefined, null), manifest([v('color-contrast', [node('.btn')])]), 'a11y/axe');
    expect(oldBaseline.map((d) => d.message)).toEqual(['Accessibility results were not compared: base was captured with no accessibility checks, head with axe-core 4.14.0 (wcag2a). Capture both with the same tags and axe-core version.']);
    const unchecked = accessibilityDrafts(manifest([]), manifest(undefined, undefined, null), 'a11y/axe');
    expect(unchecked.map((d) => [d.verdict, d.message])).toEqual([
      ['insufficient-evidence', 'Accessibility was not checked: the head captures were made without axe-core. Capture them with a policy that has an accessibility rule.'],
    ]);
  });

  it('reports a state axe could not check as insufficient evidence', () => {
    const drafts = accessibilityDrafts(manifest([]), manifest(undefined, 'axe failed: boom'), 'a11y/axe');
    expect(drafts).toEqual([expect.objectContaining({ verdict: 'insufficient-evidence', message: 'Accessibility of home/default (desktop) was not checked: axe failed: boom.' })]);
  });
});
