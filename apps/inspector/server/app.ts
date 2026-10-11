import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ALL_CHECKS, VERSION, type ProgressEvent } from '@design-warden/cli';
import { guidanceExcerpt, loadPolicyFile, resolveInside, type Report } from '@design-warden/core';
import { listScenarios, loadScenario, runScenario, type SemanticMode } from '@design-warden/harness';

/**
 * The inspector's local service (ADR 0010). It only listens on loopback, rejects requests
 * whose Host or Origin is not this server (DNS rebinding, CSRF), takes no paths, commands or
 * code from clients, and runs only the scenarios that exist in fixtures/scenarios.
 */

export interface RunState {
  runId: string;
  scenarioId: string;
  options: { visual: boolean; semantic: SemanticMode };
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  events: (ProgressEvent | { engine: string; status: string; detail?: string; elapsedMs: number })[];
  report?: Report;
  mismatches?: string[];
  artifactDir?: string;
  error?: string;
}

export interface InspectorOptions {
  port: number;
  /** Built UI (vite build output). Optional: the API works without it. */
  staticDir?: string;
  demoPolicy: string;
}

const MAX_BODY = 4096;
const MAX_RUNS = 50;
const IMAGE = /\.png$/i;

export function createInspector(opts: InspectorOptions): http.Server {
  const runs = new Map<string, RunState>();
  let active: string | null = null;
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    // DNS-rebinding defence: a page on another site cannot reach us through a hostname it controls.
    if (!allowedHosts.has(req.headers.host ?? '')) return json(res, 421, { error: 'unexpected Host header' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveUi(res, url.pathname);
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });
  // A run blocks the event loop for seconds. With Node's 5 s default, a poll that falls due when it resumes can
  // reuse a keep-alive socket in the same tick as the idle timeout closes it, and the client sees ECONNRESET.
  // ponytail: a long keep-alive hides event-loop stalls on a loopback-only service; running scenarios in a worker would remove the stalls.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    if (req.method === 'GET' && parts[0] === 'health') return json(res, 200, { ok: true, version: VERSION });

    if (req.method === 'GET' && parts[0] === 'scenarios' && parts.length === 1) {
      return json(
        res,
        200,
        listScenarios().map((s) => ({
          id: s.id,
          number: s.number,
          title: s.title,
          kind: s.kind,
          summary: s.summary,
          whyItMatters: s.whyItMatters,
          expected: s.expected,
          touchedFiles: s.touchedFiles,
          hasReplay: Boolean(s.replayFile),
          policyFromBase: s.policyFromBase,
        })),
      );
    }

    if (parts[0] === 'runs' && parts.length === 1) {
      if (req.method === 'GET') {
        return json(res, 200, [...runs.values()].reverse().map(({ runId, scenarioId, status, startedAt, options, report }) => ({ runId, scenarioId, status, startedAt, options, outcome: report?.outcome })));
      }
      if (req.method === 'POST') {
        // CSRF defence: only JSON from this origin. A cross-site form or fetch cannot satisfy both.
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'expected application/json' });
        const origin = req.headers.origin;
        if (origin !== undefined && !allowedOrigins.has(origin)) return json(res, 403, { error: 'cross-origin request refused' });
        let body: Record<string, unknown>;
        try {
          body = await readBody(req);
        } catch {
          return json(res, 413, { error: 'request body too large' });
        }
        const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : '';
        const visual = body.visual === true;
        const semantic: SemanticMode = body.semantic === 'replay' ? 'replay' : 'off';
        try {
          loadScenario(scenarioId); // must be a known scenario id
        } catch {
          return json(res, 400, { error: 'unknown scenario' });
        }
        if (active) return json(res, 409, { error: 'a run is already in progress', runId: active });
        const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
        const state: RunState = { runId, scenarioId, options: { visual, semantic }, status: 'running', startedAt: new Date().toISOString(), events: [] };
        runs.set(runId, state);
        while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
        active = runId;
        runScenario(scenarioId, { visual, semantic, onProgress: (e) => state.events.push(e) })
          .then((r) => Object.assign(state, { status: 'done', report: r.report, mismatches: r.mismatches, artifactDir: r.report.visual ? path.join(r.runDir, 'artifacts') : undefined }))
          .catch((err: Error) => Object.assign(state, { status: 'failed', error: err.message }))
          .finally(() => (active = null));
        return json(res, 202, { runId });
      }
    }

    if (req.method === 'GET' && parts[0] === 'runs' && parts[1]) {
      const run = runs.get(parts[1]);
      if (!run) return json(res, 404, { error: 'unknown run' });
      if (parts.length === 2) {
        const { artifactDir: _hidden, ...visible } = run;
        return json(res, 200, visible);
      }
      if (parts[2] === 'artifacts' && run.artifactDir) {
        const rel = parts.slice(3).map(decodeURIComponent).join('/');
        if (!IMAGE.test(rel)) return json(res, 404, { error: 'not found' });
        let file: string;
        try {
          file = resolveInside(run.artifactDir, rel);
        } catch {
          return json(res, 400, { error: 'invalid path' });
        }
        if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
        return;
      }
    }

    if (req.method === 'GET' && parts[0] === 'guidance' && parts[1]) {
      // Only guidance entries named by the demo policy, read through the same path checks as the CLI.
      const loaded = loadPolicyFile(opts.demoPolicy, ALL_CHECKS);
      const g = loaded.policy.guidance[parts[1]];
      if (!g?.path) return json(res, 404, { error: 'unknown guidance' });
      const text = fs.readFileSync(resolveInside(loaded.root, g.path), 'utf8');
      return json(res, 200, { id: parts[1], title: g.title, path: g.path, section: g.section ?? null, url: g.url ?? null, text: guidanceExcerpt(text, g.section, 8000) });
    }

    return json(res, 404, { error: 'not found' });
  }

  function serveUi(res: http.ServerResponse, pathname: string) {
    if (!opts.staticDir || !fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The inspector UI is not built yet. Run: pnpm --filter @design-warden/inspector build');
      return;
    }
    let file: string;
    try {
      file = resolveInside(opts.staticDir, decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(opts.staticDir, 'index.html');
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c); // over the limit: keep draining, stop buffering, answer 413 at the end
    });
    req.on('end', () => {
      if (size > MAX_BODY) return reject(new Error('request body too large'));
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(typeof v === 'object' && v !== null ? v : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}
