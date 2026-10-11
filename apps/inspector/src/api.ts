import type { OverallOutcome, ProvenanceClass, Report } from '@design-warden/core';

/** Client for the local inspector service (server/app.ts). Shapes mirror its JSON responses. */

export interface Scenario {
  id: string;
  number: number;
  title: string;
  kind: string;
  summary: string;
  whyItMatters: string;
  expected: {
    outcome: OverallOutcome;
    findings: { ruleId: string; file?: string; line?: number; outcome?: string; messageIncludes?: string }[];
    absentRules: string[];
    provenance: { component: string; classification: ProvenanceClass }[];
    note?: string;
  };
  touchedFiles: string[];
  hasReplay: boolean;
  policyFromBase: boolean;
}

export type SemanticOption = 'off' | 'replay';

export interface RunEvent {
  engine: string;
  status: string;
  detail?: string;
  elapsedMs: number;
}

export interface Run {
  runId: string;
  scenarioId: string;
  options: { visual: boolean; semantic: SemanticOption };
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  events: RunEvent[];
  report?: Report;
  mismatches?: string[];
  error?: string;
}

export interface Guidance {
  id: string;
  title: string;
  path: string;
  section: string | null;
  url: string | null;
  text: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** Set on 409: the run that is already in progress. */
  readonly runId?: string;
  constructor(status: number, message: string, runId?: string) {
    super(message);
    this.status = status;
    this.runId = runId;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiError(0, `cannot reach the inspector API (${(err as Error).message})`);
  }
  const body = (await res.json().catch(() => null)) as { error?: unknown; runId?: unknown } | null;
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status} ${res.statusText}`.trim();
    throw new ApiError(res.status, message, typeof body?.runId === 'string' ? body.runId : undefined);
  }
  if (body === null) throw new ApiError(res.status, 'the API answered with something that is not JSON');
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>('/api/health'),
  scenarios: () => request<Scenario[]>('/api/scenarios'),
  runs: () => request<Pick<Run, 'runId' | 'scenarioId' | 'status'>[]>('/api/runs'),
  run: (runId: string) => request<Run>(`/api/runs/${encodeURIComponent(runId)}`),
  startRun: (body: { scenarioId: string; visual: boolean; semantic: SemanticOption }) =>
    request<{ runId: string }>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  guidance: (id: string) => request<Guidance>(`/api/guidance/${encodeURIComponent(id)}`),
};

/** Artifact paths come from the report (untrusted): each segment is encoded; the server confines them to the run. */
export const artifactUrl = (runId: string, rel: string) =>
  `/api/runs/${encodeURIComponent(runId)}/artifacts/${rel.split('/').map(encodeURIComponent).join('/')}`;

/** Parses a report file and checks the minimum shape the inspector needs. Throws a readable error. */
export function parseReportFile(text: string): Report {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`The file is not valid JSON (${(err as Error).message}).`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The file does not contain a JSON object.');
  const r = value as Record<string, unknown>;
  if (r.reportVersion !== 1) {
    throw new Error(`Not a Design Warden report: expected "reportVersion": 1, found ${JSON.stringify(r.reportVersion) ?? 'no reportVersion'}.`);
  }
  if (!Array.isArray(r.findings)) throw new Error('Not a Design Warden report: "findings" must be an array.');
  if (!Array.isArray(r.engines)) throw new Error('Not a Design Warden report: "engines" must be an array.');
  return value as Report;
}
