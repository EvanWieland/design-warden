import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInspector } from './app.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let server: http.Server;
let port = 0;

beforeAll(async () => {
  // Reserve a free port first: the server needs to know its own port to validate Host headers.
  port = await new Promise<number>((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const p = (probe.address() as { port: number }).port;
      probe.close(() => resolve(p));
    });
  });
  server = createInspector({ port, demoPolicy: path.resolve(here, '../../demo/design-warden.policy.json') });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
});
afterAll(() => server.close());

/** Raw request so tests can set Host and Origin headers that fetch() would not allow. */
function request(method: string, url: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}
const post = (body: object, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  request('POST', '/api/runs', { headers, body: JSON.stringify(body) });

describe('inspector service security', () => {
  it('rejects requests addressed to another host name (DNS rebinding)', async () => {
    expect((await request('GET', '/api/health', { headers: { host: 'evil.example:80' } })).status).toBe(421);
  });

  it('refuses cross-site and non-JSON requests to start runs (CSRF)', async () => {
    expect((await post({ scenarioId: 'hardcoded-color' }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({ scenarioId: 'hardcoded-color' }, { 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403);
  });

  it('only runs known scenarios', async () => {
    expect((await post({ scenarioId: '../../etc' })).status).toBe(400);
    expect((await post({ scenarioId: 'rm -rf /' })).status).toBe(400);
  });

  it('serves guidance only for entries named in the policy', async () => {
    const ok = await request('GET', '/api/guidance/states');
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ id: 'states', title: 'Interaction states' });
    expect((await request('GET', '/api/guidance/..%2F..%2Fpackage.json')).status).toBe(404);
  });

  it('sets a restrictive content security policy', async () => {
    const res = await new Promise<http.IncomingMessage>((r) => http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { host: `127.0.0.1:${port}` } }, r));
    res.resume();
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('inspector runs', () => {
  it('runs a scenario with live progress, one run at a time, and returns the real report', async () => {
    const start = await post({ scenarioId: 'hardcoded-color', semantic: 'replay' });
    expect(start.status).toBe(202);
    const { runId } = JSON.parse(start.body) as { runId: string };
    expect((await post({ scenarioId: 'raw-control' })).status).toBe(409);

    let run: { status: string; events: { engine: string }[]; report?: { outcome: string }; mismatches?: string[] };
    do {
      await new Promise((r) => setTimeout(r, 200));
      run = JSON.parse((await request('GET', `/api/runs/${runId}`)).body);
    } while (run.status === 'running');

    expect(run.status).toBe('done');
    expect(run.report?.outcome).toBe('fail');
    expect(run.mismatches).toEqual([]);
    expect(run.events.map((e) => e.engine)).toEqual(expect.arrayContaining(['harness', 'source', 'semantic', 'run']));
    expect(JSON.parse((await request('GET', '/api/runs')).body)[0]).toMatchObject({ runId, outcome: 'fail' });
  });

  it('refuses request bodies over the limit', async () => {
    const res = await post({ scenarioId: 'hardcoded-color', padding: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
  });

  it('serves a real run artifact but nothing outside the run directory', async () => {
    const start = await post({ scenarioId: 'token-change', visual: true });
    expect(start.status).toBe(202);
    const { runId } = JSON.parse(start.body) as { runId: string };
    let run: { status: string; report?: { visual?: { diffs: { images: { diff?: string } }[] } } };
    do {
      await new Promise((r) => setTimeout(r, 500));
      run = JSON.parse((await request('GET', `/api/runs/${runId}`)).body);
    } while (run.status === 'running');
    expect(run.status).toBe('done');
    const diff = run.report!.visual!.diffs.find((d) => d.images.diff)!.images.diff!;
    expect((await request('GET', `/api/runs/${runId}/artifacts/${diff}`)).status).toBe(200);
    // Each of these reaches resolveInside (a known run with an artifact directory) and is rejected there.
    for (const evil of ['..%2F..%2Fworkspace%2Fpackage.json.png', '..%5C..%5Creport.png', 'C%3A%5CWindows%5Cwin.png', '%5C%5Cserver%5Cshare%5Cx.png']) {
      expect((await request('GET', `/api/runs/${runId}/artifacts/${evil}`)).status, evil).toBe(400);
    }
    expect((await request('GET', `/api/runs/${runId}/artifacts/report.json`)).status).toBe(404); // only .png
  }, 240_000);
});
