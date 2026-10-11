import { Component, useId, useState, type ReactNode } from 'react';
import type {
  Box,
  EngineStatus,
  Evidence,
  Finding,
  GuidanceRef,
  ProvenanceRecord,
  Report,
  SemanticSummary,
  Summary,
} from '@design-warden/core';
import type { Scenario } from './api.ts';
import { ENGINE_LABEL, formatLocation, formatMs, formatPct, ORIGIN_LABEL, STATUS_LABEL, toneOf, upper, VERDICT_LABEL } from './format.ts';
import { GuidanceDialog } from './Guidance.tsx';
import { Alert, Badge, Button, Card, EmptyState, Path, Select } from './ui.tsx';
import { VisualViewer } from './VisualViewer.tsx';

/*
 * Renders a Design Warden report. All report text is untrusted (repository text and model output):
 * it is only ever rendered as React text, never as HTML or links.
 */

type OpenCapture = (capture: string, focus?: Box) => void;

interface ReportProps {
  report: Report;
  /** Present for runs served by the local API: enables guidance panels and screenshots. */
  runId?: string;
  expectation?: { expected: Scenario['expected']; mismatches: string[] };
}

/** A malformed report file must not take the whole inspector down. Key it by report to reset. */
export function ReportView(props: ReportProps) {
  return (
    <Boundary>
      <ReportBody {...props} />
    </Boundary>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <Alert tone="danger">This report could not be displayed: {this.state.error.message}</Alert> : this.props.children;
  }
}

function ReportBody(props: ReportProps) {
  const { report, runId } = props;
  const [guidance, setGuidance] = useState<GuidanceRef | null>(null);
  const [capture, setCapture] = useState<{ capture: string; focus?: Box } | null>(null);
  const diffs = report.visual?.diffs ?? [];
  const live = runId !== undefined;
  const openCapture: OpenCapture | undefined = live ? (c, focus) => setCapture({ capture: c, focus }) : undefined;
  const viewed = capture && diffs.find((d) => d.capture === capture.capture);

  return (
    <div className="report">
      <OutcomeBanner report={report} />
      <div className="report__grid">
        {props.expectation && <Expectation actual={report.outcome} {...props.expectation} />}
        <Engines engines={report.engines} />
        <Counts report={report} />
      </div>
      {report.semantic && <Semantic summary={report.semantic} />}
      <Findings findings={report.findings} onGuidance={live ? setGuidance : undefined} onCapture={diffs.length ? openCapture : undefined} live={live} />
      <Provenance records={report.provenance ?? []} />
      <VisualChanges report={report} onOpen={openCapture} />
      {guidance && <GuidanceDialog guidance={guidance} onClose={() => setGuidance(null)} />}
      {viewed && runId && <VisualViewer runId={runId} diff={viewed} focus={capture?.focus} onClose={() => setCapture(null)} />}
    </div>
  );
}

function OutcomeBanner({ report }: { report: Report }) {
  const id = useId();
  const reasons = report.outcomeReasons ?? [];
  const t = report.target;
  const meta: string[] = [];
  if (report.policy) meta.push(`Policy: ${report.policy.name} (revision ${report.policy.revision}, ${report.policy.source})`);
  if (t) meta.push(t.base ? `Compared with ${t.base.ref}${t.base.sha ? ` at ${t.base.sha.slice(0, 8)}` : ''}, scope ${t.scope}` : `Whole project, scope ${t.scope}`);
  if (t?.only) meta.push(`Only ${t.only} findings are included (--only)`);
  if (report.generatedAt) meta.push(`Generated ${new Date(report.generatedAt).toLocaleString()}${report.durationMs !== undefined ? ` in ${formatMs(report.durationMs)}` : ''}`);
  if (report.tool) meta.push(`${report.tool.name} ${report.tool.version}`);
  return (
    <section className={`banner banner--${toneOf(report.outcome)}`} aria-labelledby={id}>
      <div className="banner__top">
        <h3 id={id} className="banner__title">
          <span className="banner__eyebrow">Result</span> <span className="banner__outcome">{upper(report.outcome)}</span>
        </h3>
        <p className="banner__exit">
          Exit code <strong>{report.exitCode ?? 'not recorded'}</strong>
        </p>
      </div>
      {reasons.length > 0 && (
        <ul className="banner__reasons">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {meta.length > 0 && <p className="banner__meta">{meta.join(' · ')}</p>}
      {t?.changedFiles?.length ? (
        <details className="banner__files">
          <summary>{t.changedFiles.length} changed file(s)</summary>
          <ul className="file-list">
            {t.changedFiles.map((f) => (
              <li key={f}>
                <Path path={f} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Expectation(props: { actual: string; expected: Scenario['expected']; mismatches: string[] }) {
  const { mismatches } = props;
  return (
    <Card title="Expected vs actual">
      <p className="inline-row">
        Expected <Badge tone={toneOf(props.expected.outcome)}>{upper(props.expected.outcome)}</Badge> got{' '}
        <Badge tone={toneOf(props.actual)}>{upper(props.actual)}</Badge>
      </p>
      {mismatches.length === 0 ? (
        <p className="match match--ok">Matches expectations</p>
      ) : (
        <div>
          <p className="match match--bad">Does not match expectations ({mismatches.length})</p>
          <ul className="mismatches">
            {mismatches.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint">
        Compared: the outcome, deterministic findings (missing or unexpected), absent rules and provenance. Model and visual findings are not part of the
        expectations.
      </p>
    </Card>
  );
}

function Engines({ engines }: { engines: EngineStatus[] }) {
  return (
    <Card title="Engines">
      {engines.length === 0 ? (
        <p className="hint">The report lists no engines.</p>
      ) : (
        <ul className="engines">
          {engines.map((e, i) => (
            <li key={i} className={`engine engine--${toneOf(e.status)}`}>
              <div className="engine__row">
                <span className="engine__name">{ENGINE_LABEL[e.engine] ?? e.engine}</span>
                <Badge tone={toneOf(e.status)}>{STATUS_LABEL[e.status] ?? e.status}</Badge>
                {e.durationMs !== undefined && <span className="engine__time">{formatMs(e.durationMs)}</span>}
              </div>
              {e.reason && <p className="engine__reason">{e.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Counted = Pick<Summary, 'byOutcome' | 'byCategory' | 'byOrigin' | 'suppressed' | 'preexisting'>;

/** core's summarize() rule, for report files without a summary: suppressed and pre-existing findings are counted apart. */
function summarize(findings: Finding[]): Counted {
  const s: Counted = { byOutcome: { fail: 0, review: 0, info: 0 }, byCategory: {}, byOrigin: { deterministic: 0, heuristic: 0, ai: 0 }, suppressed: 0, preexisting: 0 };
  for (const f of findings) {
    if (f.suppressed) s.suppressed++;
    else if (f.preexisting) s.preexisting++;
    else {
      s.byOutcome[f.outcome]++;
      s.byCategory[f.category] = (s.byCategory[f.category] ?? 0) + 1;
      s.byOrigin[f.origin]++;
    }
  }
  return s;
}

function Counts({ report }: { report: Report }) {
  const s = report.summary ?? summarize(report.findings);
  const groups: [string, [string, number | undefined][]][] = [
    ['By outcome', [['Fail', s.byOutcome.fail], ['Review', s.byOutcome.review], ['Info', s.byOutcome.info]]],
    ['By origin', [['Deterministic', s.byOrigin.deterministic], ['Heuristic', s.byOrigin.heuristic], ['AI', s.byOrigin.ai]]],
    ['By category', Object.entries(s.byCategory)],
    ['Not counted above', [['Suppressed', s.suppressed], ['Pre-existing', s.preexisting]]],
  ];
  return (
    <Card title="Counts">
      <div className="counts">
        {groups.map(([title, rows]) => (
          <div key={title}>
            <h4 className="subhead">{title}</h4>
            {rows.length === 0 ? (
              <p className="hint">None</p>
            ) : (
              <dl className="kv">
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v ?? 0}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Semantic({ summary: s }: { summary: SemanticSummary }) {
  return (
    <Card title="Semantic review" className="card--ai">
      <p className="hint">Model findings are advisory: they can ask for review but never block. Model text is shown as plain text.</p>
      <dl className="kv">
        <div>
          <dt>Provider</dt>
          <dd>{s.provider}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{s.model ?? 'not reported'}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>{s.endpoint ?? 'no network'}</dd>
        </div>
        <div>
          <dt>{s.dryRun ? 'Data in the request (dry run, not sent)' : 'Data sent'}</dt>
          <dd>
            {s.dataSent.files.length} file(s), {s.dataSent.characters} characters, {s.dataSent.screenshots} screenshot(s), {s.dataSent.redactions} redaction(s)
          </dd>
        </div>
        {s.usage && (
          <div>
            <dt>Tokens</dt>
            <dd>
              {s.usage.inputTokens ?? '?'} in, {s.usage.outputTokens ?? '?'} out
            </dd>
          </div>
        )}
      </dl>
      {s.dataSent.files.length > 0 && (
        <div>
          <h4 className="subhead">{s.dryRun ? 'Files in the request' : 'Files sent'}</h4>
          <ul className="file-list">
            {s.dataSent.files.map((f) => (
              <li key={f}>
                <Path path={f} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="tally">
        <div>
          <dt>Accepted</dt>
          <dd>{s.accepted}</dd>
        </div>
        <div>
          <dt>Downgraded</dt>
          <dd>{s.downgraded}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd>{s.rejected.length}</dd>
        </div>
      </dl>
      {s.rejected.length > 0 && (
        <div>
          <h4 className="subhead">Rejected model findings</h4>
          <ul className="rejected">
            {s.rejected.map((r, i) => (
              <li key={i} className="rejected__item">
                <p>
                  <span className="label">Reason</span> {r.reason}
                </p>
                {(r.ruleId || r.file) && (
                  <p className="inline-row">
                    {r.ruleId && <code>{r.ruleId}</code>}
                    {r.file && <code>{r.file}{r.line ? `:${r.line}` : ''}</code>}
                  </p>
                )}
                {r.message && <p className="rejected__message">Model said: {r.message}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Findings(props: { findings: Finding[]; live: boolean; onGuidance?: (g: GuidanceRef) => void; onCapture?: OpenCapture }) {
  const { findings } = props;
  const [outcome, setOutcome] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [rule, setRule] = useState('all');
  const [showHidden, setShowHidden] = useState(false);
  const headingId = useId();
  const isHidden = (f: Finding) => Boolean(f.suppressed || f.preexisting);
  const hidden = findings.filter(isHidden).length;
  const rules = [...new Set(findings.map((f) => f.ruleId))].sort();
  const shown = findings.filter(
    (f) =>
      (showHidden || !isHidden(f)) &&
      (outcome === 'all' || f.outcome === outcome) &&
      (origin === 'all' || f.origin === origin) &&
      (rule === 'all' || f.ruleId === rule),
  );

  return (
    <section className="findings" aria-labelledby={headingId}>
      <h3 id={headingId} className="section-title">
        Findings
      </h3>
      <div className="filters" role="group" aria-label="Filter findings">
        <Select label="Outcome" value={outcome} onChange={setOutcome} options={[['all', 'All outcomes'], ['fail', 'Fail'], ['review', 'Review'], ['info', 'Info']]} />
        <Select
          label="Origin"
          value={origin}
          onChange={setOrigin}
          options={[['all', 'All origins'], ['deterministic', 'Deterministic'], ['heuristic', 'Heuristic'], ['ai', 'AI']]}
        />
        <Select label="Rule" value={rule} onChange={setRule} options={[['all', 'All rules'], ...rules.map((r): [string, string] => [r, r])]} />
        <label className="check filters__toggle">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          <span>Show suppressed and pre-existing ({hidden})</span>
        </label>
      </div>
      <p className="hint" role="status">
        Showing {shown.length} of {findings.length} finding(s)
        {!showHidden && hidden > 0 ? `; ${hidden} suppressed or pre-existing hidden` : ''}.
      </p>
      {findings.length === 0 ? (
        <EmptyState title="No findings">The engines reported nothing for this change.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No findings match">
          {!showHidden && hidden === findings.length
            ? 'Every finding is suppressed or pre-existing. Tick "Show suppressed and pre-existing" to see them.'
            : 'Change the filters to see more findings.'}
        </EmptyState>
      ) : (
        <div className="finding-list">
          {shown.map((f, i) => (
            <FindingCard key={`${f.id}-${i}`} finding={f} live={props.live} onGuidance={props.onGuidance} onCapture={props.onCapture} />
          ))}
        </div>
      )}
    </section>
  );
}

function FindingCard(props: { finding: Finding; live: boolean; onGuidance?: (g: GuidanceRef) => void; onCapture?: OpenCapture }) {
  const f = props.finding;
  const titleId = useId();
  const guidance = f.guidance ?? [];
  return (
    <article className={`finding finding--${toneOf(f.outcome)}${f.origin === 'ai' ? ' finding--ai' : ''}`} aria-labelledby={titleId}>
      <div className="finding__head">
        <Badge tone={toneOf(f.outcome)}>{upper(f.outcome)}</Badge>
        <h4 id={titleId} className="finding__title">
          <code className="finding__rule">{f.ruleId}</code> <span>{f.title}</span>
        </h4>
        <span className="finding__tags">
          <Badge tone={f.origin === 'ai' ? 'ai' : 'neutral'}>{ORIGIN_LABEL[f.origin] ?? f.origin}</Badge>
          {f.suppressed && <Badge>Suppressed</Badge>}
          {f.preexisting && <Badge>Pre-existing</Badge>}
        </span>
      </div>
      <dl className="finding__meta">
        <div>
          <dt>Category</dt>
          <dd>{f.category}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{f.severity}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{f.confidence}</dd>
        </div>
        <div>
          <dt>Verdict</dt>
          <dd>{VERDICT_LABEL[f.verdict] ?? f.verdict}</dd>
        </div>
        <div>
          <dt>Engine</dt>
          <dd>{f.engine}</dd>
        </div>
      </dl>
      <p className="finding__location">
        <code>{f.location ? formatLocation(f.location) : 'Project-wide (no file location)'}</code>
      </p>
      <p className="finding__message">{f.message}</p>
      <EvidenceList evidence={f.evidence ?? []} live={props.live} onCapture={props.onCapture} />
      {f.suggestion && (
        <div className="finding__suggestion">
          <span className="label">Suggested fix</span>
          <p>{f.suggestion}</p>
        </div>
      )}
      {f.remediation && (
        <p>
          <span className="label">Remediation</span> {f.remediation}
        </p>
      )}
      <p>
        <span className="label">Why this outcome</span> {f.outcomeReason}
      </p>
      {f.suppressed && (
        <p>
          <span className="label">Suppressed</span> by {f.suppressed.by}
          {f.suppressed.exceptionId ? ` (${f.suppressed.exceptionId})` : ''}: {f.suppressed.reason}
        </p>
      )}
      {f.rationale && (
        <details className="finding__rationale">
          <summary>Rationale</summary>
          <p>{f.rationale}</p>
        </details>
      )}
      {guidance.length > 0 && (
        <div className="finding__guidance">
          <span className="label">Guidance</span>
          <ul className="inline-list">
            {guidance.map((g) => (
              <li key={g.id}>
                {props.onGuidance ? (
                  <Button variant="link" onClick={() => props.onGuidance?.(g)}>
                    {g.title}
                  </Button>
                ) : (
                  <span>
                    {g.title}
                    {g.path && (
                      <>
                        {' '}
                        <code>{g.path}{g.section ? ` › ${g.section}` : ''}</code>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

type Ev<K extends Evidence['kind']> = Extract<Evidence, { kind: K }>;
const ofKind = <K extends Evidence['kind']>(evidence: Evidence[], kind: K) => evidence.filter((e): e is Ev<K> => e.kind === kind);

function EvidenceList(props: { evidence: Evidence[]; live: boolean; onCapture?: OpenCapture }) {
  const { evidence, onCapture } = props;
  if (evidence.length === 0) return null;
  const tokens = ofKind(evidence, 'token-change');
  const usages = ofKind(evidence, 'usage');
  const shots = ofKind(evidence, 'screenshot');
  return (
    <div className="evidence">
      <span className="label">Evidence</span>
      {ofKind(evidence, 'code').map((e, i) => (
        <figure key={i} className="code">
          <figcaption className="code__file">
            <code>
              {e.file}:{e.line}
            </code>
          </figcaption>
          <pre className="code__body">
            <code>
              {e.snippet.split('\n').map((text, j) => (
                <span key={j}>
                  <span className="code__ln" aria-hidden="true">
                    {e.line + j}
                  </span>
                  {text}
                  {'\n'}
                </span>
              ))}
            </code>
          </pre>
        </figure>
      ))}
      {tokens.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">Changed tokens</caption>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Before → after</th>
                <th scope="col">Usages</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t, i) => (
                <tr key={i}>
                  <td>
                    <code>{t.token}</code>
                  </td>
                  <td>
                    <code>{t.before ?? '(new)'}</code> → <code>{t.after ?? '(removed)'}</code>
                  </td>
                  <td>
                    {t.usages.length}
                    {t.usages.length > 0 && (
                      <ul className="file-list">
                        {t.usages.map((u) => (
                          <li key={u}>
                            <Path path={u} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {usages.length > 0 && (
        <ul className="evidence__list">
          {usages.map((u, i) => (
            <li key={i}>
              <code>
                {u.file}:{u.line}
              </code>{' '}
              {u.detail}
            </li>
          ))}
        </ul>
      )}
      {ofKind(evidence, 'note').map((n, i) => (
        <p key={i} className="evidence__note">
          {n.text}
        </p>
      ))}
      {shots.length > 0 && (
        <ul className="evidence__list">
          {shots.map((s, i) => (
            <li key={i}>
              Screenshot <code>{s.capture}</code>
              {s.region && (
                <>
                  , region {s.region.width} × {s.region.height} at {s.region.x}, {s.region.y}
                  {s.region.label && (
                    <>
                      {' '}
                      near <code>{s.region.label}</code>
                    </>
                  )}
                </>
              )}{' '}
              {onCapture ? (
                <Button variant="link" onClick={() => onCapture(s.capture, s.region)}>
                  Open in visual viewer<span className="visually-hidden"> ({s.capture})</span>
                </Button>
              ) : (
                <span className="hint">{props.live ? '(no images for this capture)' : '(screenshots are not available in file mode)'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Provenance({ records }: { records: ProvenanceRecord[] }) {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  return (
    <Card title="Provenance">
      {records.length === 0 ? (
        <p className="hint">No changed components were classified.</p>
      ) : (
        <div className="table-wrap">
          <table className="table table--wide">
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Location</th>
                <th scope="col">Classification</th>
                <th scope="col">Nearest precedent</th>
                <th scope="col">Signals</th>
                <th scope="col">Explanation</th>
              </tr>
            </thead>
            <tbody>
              {records.map((p, i) => (
                <tr key={i}>
                  <td>
                    <code>{p.component}</code>
                  </td>
                  <td>
                    <Path path={formatLocation(p)} />
                  </td>
                  <td>
                    <Badge tone={toneOf(p.classification)}>{p.classification}</Badge>
                  </td>
                  <td>
                    {p.nearest ? (
                      <>
                        {p.nearest.kind} <code>{p.nearest.id}</code> in <Path path={p.nearest.source} />, similarity {p.nearest.similarity.toFixed(2)}
                      </>
                    ) : (
                      'none'
                    )}
                  </td>
                  <td>
                    <dl className="signals">
                      <div>
                        <dt>Design-system components</dt>
                        <dd>{list(p.signals.designSystemComponents)}</dd>
                      </div>
                      <div>
                        <dt>Raw elements</dt>
                        <dd>{list(p.signals.rawElements)}</dd>
                      </div>
                      <div>
                        <dt>Elements</dt>
                        <dd>{p.signals.elementCount}</dd>
                      </div>
                      <div>
                        <dt>Dynamic</dt>
                        <dd>{list(p.signals.dynamic)}</dd>
                      </div>
                    </dl>
                  </td>
                  <td>{p.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function VisualChanges({ report, onOpen }: { report: Report; onOpen?: OpenCapture }) {
  if (!report.visual) {
    const reason = report.engines.find((e) => e.engine === 'visual')?.reason;
    return (
      <Card title="Visual changes">
        <EmptyState title="No visual comparison">
          {reason ? `The visual engine did not compare screenshots: ${reason}.` : 'This report has no visual comparison.'}
          {onOpen && ' Tick "Visual capture" and run the scenario again to compare screenshots.'}
        </EmptyState>
      </Card>
    );
  }
  const diffs = report.visual.diffs;
  const changed = diffs.filter((d) => d.status !== 'unchanged');
  return (
    <Card title="Visual changes">
      <p className="hint">
        {changed.length} of {diffs.length} capture(s) differ from the base.
        {!onOpen && ' Screenshots are not available in file mode.'}
      </p>
      {changed.length === 0 ? (
        <EmptyState title="Nothing to compare">Every capture matches the base.</EmptyState>
      ) : (
        <ul className="captures">
          {changed.map((d) => (
            <li key={d.capture} className="capture">
              <div className="capture__head">
                <span className="capture__name">
                  {d.route} / {d.state} / {d.viewport}
                </span>
                <Badge tone={toneOf(d.status)}>{d.status}</Badge>
              </div>
              <p className="hint">
                {formatPct(d.changedRatio)} of pixels changed · {d.regions.length} region(s)
              </p>
              {d.error && <p className="capture__error">{d.error}</p>}
              {onOpen && (d.images.before || d.images.after || d.images.diff) && (
                <Button onClick={() => onOpen(d.capture)}>
                  Compare images<span className="visually-hidden"> for {d.capture}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
