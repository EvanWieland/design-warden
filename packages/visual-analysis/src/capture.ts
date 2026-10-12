/// <reference lib="dom" />
// page.evaluate() callbacks below run in the browser.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveInside, type VisualAction, type VisualConfig } from '@design-warden/core';
import { chromium, type Page } from 'playwright';
import { VisualError } from './compare.ts';
import { MANIFEST_FILE, type CaptureEntry, type CaptureManifest, type CapturedElement } from './manifest.ts';

export interface CaptureOptions {
  baseUrl: string;
  visual: VisualConfig;
  outDir: string;
  /** Run axe-core with these rule tags on every state (set when the policy has an accessibility rule). */
  accessibility?: { tags: string[] };
  onProgress?: (message: string) => void;
}

/** Fixed instant for Date.now() in captured pages, so rendered dates never drift. */
const FIXED_TIME = new Date('2026-10-06T09:00:00Z');
const MAX_ELEMENTS = 1500;

/**
 * Captures every route x state x viewport with a deterministic browser preset
 * (docs/research/visual-regression.md): fixed time, seeded Math.random, no animations,
 * hidden caret, reduced motion, UTC, and every request outside the app's origin blocked.
 */
export async function captureAll(opts: CaptureOptions): Promise<CaptureManifest> {
  const { origin, host } = new URL(opts.baseUrl);
  fs.mkdirSync(opts.outDir, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw new VisualError(`could not start Chromium (${(err as Error).message.split('\n')[0]}). Install it with: pnpm exec playwright install chromium`);
  }
  const captures: CaptureEntry[] = [];
  try {
    for (const viewport of opts.visual.viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        colorScheme: 'light',
        locale: 'en-US',
        timezoneId: 'UTC',
        serviceWorkers: 'block',
      });
      await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
      // WebSockets are not covered by route(): allow only the app's own host, close everything else.
      await context.routeWebSocket(/.*/, (ws) => (new URL(ws.url()).host === host ? ws.connectToServer() : ws.close()));
      await context.addInitScript(() => {
        let seed = 42;
        Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      });
      for (const route of opts.visual.routes) {
        for (const state of route.states) {
          const id = `${route.id}/${state.id}/${viewport.id}`;
          const url = new URL(route.path + (state.query ? `?${state.query}` : ''), opts.baseUrl).toString();
          const entry: CaptureEntry = { id, route: route.id, state: state.id, viewport: viewport.id, url };
          opts.onProgress?.(`capturing ${id}`);
          const page = await context.newPage();
          let step = `loading ${url}`;
          try {
            await page.clock.setFixedTime(FIXED_TIME);
            await page.goto(url, { waitUntil: 'load' });
            for (const action of state.actions) {
              step = `action ${JSON.stringify(action)}`;
              await perform(page, action);
            }
            if (state.waitFor) {
              step = `waiting for "${state.waitFor}"`;
              await page.locator(state.waitFor).first().waitFor({ state: 'visible', timeout: 10_000 });
            }
            step = 'screenshot';
            await page.evaluate(() => document.fonts.ready);
            const png = await stableScreenshot(page, opts.visual.mask);
            entry.file = `${id.replaceAll('/', '__')}.png`;
            fs.writeFileSync(path.join(opts.outDir, entry.file), png);
            entry.elements = await elementBoxes(page);
            if (opts.accessibility) {
              // After the screenshot, so axe cannot affect the pixels. A failure here leaves the capture usable.
              try {
                entry.accessibility = await axeViolations(page, opts.accessibility.tags);
              } catch (err) {
                entry.accessibilityError = `axe failed: ${(err as Error).message.split('\n')[0]}`;
              }
            }
          } catch (err) {
            entry.error = `${step} failed: ${(err as Error).message.split('\n')[0]}`;
          } finally {
            await page.close();
          }
          captures.push(entry);
        }
      }
      await context.close();
    }
    const manifest: CaptureManifest = {
      manifestVersion: 1,
      fingerprint: {
        playwright: createRequire(import.meta.url)('playwright/package.json').version,
        browser: `chromium ${browser.version()}`,
        headless: true,
        platform: `${process.platform}-${process.arch}`,
        deviceScaleFactor: 1,
      },
      baseUrl: opts.baseUrl,
      ...(opts.accessibility && { axe: { version: createRequire(import.meta.url)('axe-core/package.json').version, tags: opts.accessibility.tags } }),
      captures,
    };
    fs.writeFileSync(path.join(opts.outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await browser.close();
  }
}

/** Only the declarative actions the policy schema allows; nothing evaluates policy-supplied code. */
async function perform(page: Page, a: VisualAction): Promise<void> {
  if ('click' in a) await page.locator(a.click).first().click();
  else if ('hover' in a) await page.locator(a.hover).first().hover();
  else if ('focus' in a) await page.locator(a.focus).first().focus();
  else if ('fill' in a) await page.locator(a.fill).first().fill(a.value);
  else await page.locator(a.press).first().press(a.key);
}

/**
 * axe-core violations for the current page. The script is read from node_modules and evaluated in the
 * page, so no request leaves the machine, and page CSP does not apply to evaluate().
 */
async function axeViolations(page: Page, tags: string[]): Promise<NonNullable<CaptureEntry['accessibility']>> {
  await page.evaluate(fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'));
  return page.evaluate(async (values) => {
    type AxeResult = { violations: { id: string; impact?: string | null; help: string; helpUrl: string; nodes: { target: unknown[]; html: string }[] }[] };
    const axe = (window as unknown as { axe: { run(ctx: Document, opts: object): Promise<AxeResult> } }).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ rule: v.id, impact: v.impact ?? null, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.slice(0, 25).map((n) => ({ target: n.target.join(' '), html: n.html })) }));
  }, tags);
}

/** Screenshots until two consecutive images are identical (max 3 tries). */
async function stableScreenshot(page: Page, mask: string[]): Promise<Buffer> {
  const shoot = () =>
    page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css', mask: mask.map((m) => page.locator(m)), maskColor: '#ff00ff' });
  let prev = await shoot();
  for (let i = 0; i < 2; i++) {
    const next = await shoot();
    if (next.equals(prev)) return next;
    prev = next;
  }
  return prev;
}

function elementBoxes(page: Page): Promise<CapturedElement[]> {
  return page.evaluate((max) => {
    const out: { label: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 64) continue;
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
      const role = el.getAttribute('role');
      if (!cls && !role && !el.id) continue;
      const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${role ? `[role=${role}]` : ''}`;
      out.push({ label, box: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) } });
      if (out.length >= max) break;
    }
    return out;
  }, MAX_ELEMENTS);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Serves a built single-page app on 127.0.0.1 with an index.html fallback. For capture only.
 * The inspector service has its own small static handler (apps/inspector/server/app.ts); they are kept
 * separate so the network-boundary test can keep the visual package to this one module.
 */
export function serveStatic(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let file: string;
    try {
      const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '');
      // Static-site generators write /guide/intro as guide/intro.html or guide/intro/index.html (clean URLs); any other
      // path is a route of the app itself. Every candidate goes through resolveInside, symlink check included.
      const candidates = rel ? [rel, `${rel}.html`, path.posix.join(rel, 'index.html')] : [];
      file = [...candidates, 'index.html'].map((c) => resolveInside(root, c)).find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) ?? path.join(root, 'index.html');
    } catch {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    // A file can disappear between the check and the read; fail the request, not the process.
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
