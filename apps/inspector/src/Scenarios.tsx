import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, type Run, type Scenario, type SemanticOption } from './api.ts';
import { formatMs, toneOf, upper } from './format.ts';
import { ReportView } from './ReportView.tsx';
import { Alert, Badge, Button, Card, EmptyState, Path } from './ui.tsx';

type RunOptions = { visual: boolean; semantic: SemanticOption };

const POLL_MS = 500;
const kindLabel = (kind: string) => kind.replace(/-/g, ' ');

/** Scenario list, details, run options and the live run, all from the local API. */
export function ScenarioWorkspace() {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [version, setVersion] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run>>({}); // latest run per scenario id
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listHeadingId = useId();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const health = await api.health();
      const [list, recent] = await Promise.all([api.scenarios(), api.runs()]);
      setVersion(health.version);
      setScenarios(list);
      setSelectedId((id) => id ?? list[0]?.id ?? null);
      // A run started before this page loaded (another tab, a reload) still blocks new runs: follow it.
      const running = recent.find((r) => r.status === 'running');
      if (running) setActiveRunId(running.runId);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the active run until it settles. Each request waits for the previous one.
  useEffect(() => {
    if (!activeRunId) return;
    let timer = 0;
    let stopped = false;
    const tick = async () => {
      try {
        const run = await api.run(activeRunId);
        if (stopped) return;
        setRuns((r) => ({ ...r, [run.scenarioId]: run }));
        if (run.status === 'running') timer = window.setTimeout(tick, POLL_MS);
        else setActiveRunId(null);
      } catch (err) {
        if (stopped) return;
        setNotice(`Lost contact with run ${activeRunId}: ${(err as Error).message}. Its result is unknown.`);
        setActiveRunId(null);
      }
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [activeRunId]);

  const start = async (scenarioId: string, options: RunOptions) => {
    setNotice(null);
    setStarting(true);
    try {
      const { runId } = await api.startRun({ scenarioId, ...options });
      // The service accepted the run (202); polling fills in its real state and events.
      setRuns((r) => ({ ...r, [scenarioId]: { runId, scenarioId, options, status: 'running', startedAt: new Date().toISOString(), events: [] } }));
      setActiveRunId(runId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNotice('Another run is already in progress. Wait for it to finish, then start this one.');
        if (err.runId) setActiveRunId(err.runId);
      } else {
        setNotice(`Could not start the run: ${(err as Error).message}`);
      }
    } finally {
      setStarting(false);
    }
  };

  if (loadError) {
    return (
      <div className="stack">
        <Alert tone="danger">
          <strong>The inspector API is not reachable.</strong> {loadError}
        </Alert>
        <p>
          Start it from the repository root with <code>node apps/inspector/server/main.ts</code>, then retry. Opening a report file works without it.
        </p>
        <div>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!scenarios) return <p role="status">Loading scenarios…</p>;
  if (scenarios.length === 0) return <EmptyState title="No scenarios">The API found no scenarios in fixtures/scenarios.</EmptyState>;

  const selected = scenarios.find((s) => s.id === selectedId) ?? scenarios[0]!;
  const activeRun = activeRunId ? Object.values(runs).find((r) => r.runId === activeRunId) : undefined;
  const select = (id: string) => {
    setSelectedId(id);
    setNotice(null);
    // Stacked layout on narrow screens: bring the details into view.
    if (window.matchMedia('(max-width: 899px)').matches) detailRef.current?.scrollIntoView();
  };

  return (
    <div className="workspace">
      <nav className="workspace__list" aria-labelledby={listHeadingId}>
        <h2 id={listHeadingId} className="section-title">
          Scenarios
        </h2>
        <ul className="scenario-list">
          {scenarios.map((s) => (
            <li key={s.id}>
              <button type="button" className="scenario-item" aria-current={s.id === selected.id ? 'true' : undefined} onClick={() => select(s.id)}>
                <span className="scenario-item__number">{s.number}</span>
                <span className="scenario-item__body">
                  <span className="scenario-item__title">{s.title}</span>
                  <span className="scenario-item__meta">
                    <Badge>{kindLabel(s.kind)}</Badge>
                    <span>expects</span>
                    <Badge tone={toneOf(s.expected.outcome)}>{upper(s.expected.outcome)}</Badge>
                    {activeRun?.scenarioId === s.id && <Badge tone="info">running</Badge>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">Local API connected · Design Warden {version}</p>
      </nav>
      <div className="workspace__detail" ref={detailRef}>
        {activeRunId && activeRun?.scenarioId !== selected.id && (
          <Alert tone="info">
            A run is in progress{activeRun ? `: ${scenarios.find((s) => s.id === activeRun.scenarioId)?.title ?? activeRun.scenarioId}` : ''}.{' '}
            {activeRun && (
              <Button variant="link" onClick={() => select(activeRun.scenarioId)}>
                Show its progress
              </Button>
            )}
          </Alert>
        )}
        {notice && <Alert tone="warning">{notice}</Alert>}
        <ScenarioDetail
          key={selected.id}
          scenario={selected}
          run={runs[selected.id]}
          tracking={runs[selected.id]?.runId === activeRunId}
          busy={starting || activeRunId !== null}
          onRun={(options) => void start(selected.id, options)}
          onResume={(runId) => {
            setNotice(null);
            setActiveRunId(runId);
          }}
        />
      </div>
    </div>
  );
}

function ScenarioDetail(props: {
  scenario: Scenario;
  run?: Run;
  /** The run shown is the one being polled. */
  tracking: boolean;
  busy: boolean;
  onRun: (options: RunOptions) => void;
  onResume: (runId: string) => void;
}) {
  const { scenario: s, run } = props;
  const [visual, setVisual] = useState(false);
  const [semantic, setSemantic] = useState<SemanticOption>('off');
  const headingId = useId();
  const radioName = useId();
  const replayHintId = useId();
  const e = s.expected;

  return (
    <section className="scenario" aria-labelledby={headingId}>
      <header className="scenario__head">
        <p className="eyebrow">
          <span>Scenario {s.number}</span>
          <code>{s.id}</code>
          <Badge>{kindLabel(s.kind)}</Badge>
        </p>
        <h2 id={headingId} className="scenario__title">
          {s.title}
        </h2>
        <p>{s.summary}</p>
      </header>

      <div className="card-grid">
        <Card title="Why it matters">
          <p>{s.whyItMatters}</p>
        </Card>
        <Card title="Expected result">
          <p className="inline-row">
            Outcome <Badge tone={toneOf(e.outcome)}>{upper(e.outcome)}</Badge>
          </p>
          {e.findings.length > 0 ? (
            <div>
              <span className="label">Expected findings</span>
              <ul className="expected-list">
                {e.findings.map((f, i) => (
                  <li key={i}>
                    {f.outcome && <Badge tone={toneOf(f.outcome)}>{upper(f.outcome)}</Badge>} <code>{f.ruleId}</code>
                    {f.file && (
                      <>
                        {' '}
                        at <Path path={`${f.file}${f.line ? `:${f.line}` : ''}`} />
                      </>
                    )}
                    {f.messageIncludes && <span className="hint"> · message includes “{f.messageIncludes}”</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="hint">No deterministic findings are expected.</p>
          )}
          {e.absentRules.length > 0 && (
            <div>
              <span className="label">Must not report</span>
              <ul className="inline-list">
                {e.absentRules.map((r) => (
                  <li key={r}>
                    <code>{r}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {e.provenance.length > 0 && (
            <p>
              <span className="label">Provenance</span> {e.provenance.map((p) => `${p.component}: ${p.classification}`).join(', ')}
            </p>
          )}
          {e.note && <p className="hint">{e.note}</p>}
        </Card>
        <Card title="Touched files">
          <ul className="file-list">
            {s.touchedFiles.map((f) => (
              <li key={f}>
                <Path path={f} />
              </li>
            ))}
          </ul>
          {s.policyFromBase && <p className="hint">The policy is read from the base commit, as CI does with --policy-ref.</p>}
        </Card>
      </div>

      <Card title="Run">
        <label className="check">
          <input type="checkbox" checked={visual} onChange={(ev) => setVisual(ev.target.checked)} />
          <span>Visual capture (builds and screenshots the app, about 20 s)</span>
        </label>
        <fieldset className="options">
          <legend className="field__label">Semantic review</legend>
          <label className="check">
            <input type="radio" name={radioName} checked={semantic === 'off'} onChange={() => setSemantic('off')} />
            <span>Off</span>
          </label>
          {s.hasReplay ? (
            <>
              <label className="check">
                <input type="radio" name={radioName} checked={semantic === 'replay'} onChange={() => setSemantic('replay')} aria-describedby={replayHintId} />
                <span>Replay recorded model response</span>
              </label>
              <p id={replayHintId} className="hint options__hint">
                Replays a model response recorded for this scenario. No model is called and nothing is sent over the network.
              </p>
            </>
          ) : (
            <p className="hint">This scenario has no recorded model response, so semantic review stays off.</p>
          )}
        </fieldset>
        <div className="inline-row">
          <Button variant="primary" disabled={props.busy} onClick={() => props.onRun({ visual, semantic })}>
            Run scenario
          </Button>
          {props.busy && <span className="hint">A run is in progress. Runs go one at a time.</span>}
        </div>
      </Card>

      {run ? (
        <RunResult run={run} scenario={s} tracking={props.tracking} onResume={props.onResume} />
      ) : (
        <EmptyState title="No run yet">Run the scenario to see the report the engines produce for it.</EmptyState>
      )}
    </section>
  );
}

function RunResult(props: { run: Run; scenario: Scenario; tracking: boolean; onResume: (runId: string) => void }) {
  const { run } = props;
  const running = run.status === 'running' && props.tracking;
  // Last seen running, but polling stopped (lost contact): say so rather than show stale progress.
  const unknown = run.status === 'running' && !props.tracking;
  const status = running
    ? 'Running…'
    : unknown
      ? 'Lost contact with the service; the state of this run is unknown.'
      : run.status === 'failed'
        ? 'The run failed.'
        : `Finished: ${upper(run.report?.outcome)}`;
  const log = (
    <ol className="events" aria-live="polite" aria-relevant="additions">
      {run.events.map((e, i) => (
        <li key={i} className="events__item">
          <span className="events__time">
            <span className="visually-hidden">elapsed </span>
            {formatMs(e.elapsedMs)}
          </span>
          <span className="events__engine">{e.engine}</span>
          <Badge tone={toneOf(e.status)}>{e.status}</Badge>
          {e.detail && <span className="events__detail">{e.detail}</span>}
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <Card title="Run progress">
        <p role="status" className="run-status">
          {status}
        </p>
        <p className="hint">
          Run <code>{run.runId}</code> · started {new Date(run.startedAt).toLocaleTimeString()} · visual capture {run.options.visual ? 'on' : 'off'} · semantic
          review {run.options.semantic === 'replay' ? 'replay of a recorded response' : 'off'}
        </p>
        {unknown && (
          <div>
            <Button onClick={() => props.onResume(run.runId)}>Check again</Button>
          </div>
        )}
        {running ? (
          log
        ) : (
          <details>
            <summary>Event log ({run.events.length} events)</summary>
            {log}
          </details>
        )}
      </Card>
      {run.status === 'failed' && (
        <Alert tone="danger">
          <strong>Run failed:</strong> {run.error ?? 'the service reported no error message.'}
        </Alert>
      )}
      {run.status === 'done' && run.report && (
        <ReportView key={run.runId} report={run.report} runId={run.runId} expectation={{ expected: props.scenario.expected, mismatches: run.mismatches ?? [] }} />
      )}
    </>
  );
}
