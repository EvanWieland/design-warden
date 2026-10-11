import { useId, useState, type ChangeEvent } from 'react';
import type { Report } from '@design-warden/core';
import { parseReportFile } from './api.ts';
import { ReportView } from './ReportView.tsx';
import { ScenarioWorkspace } from './Scenarios.tsx';
import { Alert, EmptyState, Segmented } from './ui.tsx';

type Mode = 'scenarios' | 'file';

export function App() {
  const [mode, setMode] = useState<Mode>('scenarios');
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <h1 className="app-header__title">Design Warden Inspector</h1>
          <Segmented
            legend="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'scenarios', label: 'Demo scenarios' },
              { value: 'file', label: 'Open a report file' },
            ]}
          />
        </div>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        {/* Both stay mounted, so a scenario run keeps polling while a file is open. */}
        <div hidden={mode !== 'scenarios'}>
          <ScenarioWorkspace />
        </div>
        <div hidden={mode !== 'file'}>
          <ReportFile />
        </div>
      </main>
    </>
  );
}

function ReportFile() {
  const [loaded, setLoaded] = useState<{ key: number; name: string; report: Report } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const headingId = useId();

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLoaded(null);
    setError(null);
    if (!file) return;
    try {
      setLoaded({ key: Date.now(), name: file.name, report: parseReportFile(await file.text()) });
    } catch (err) {
      setError(`${file.name}: ${(err as Error).message}`);
    }
  };

  return (
    <div className="stack">
      <section className="card" aria-labelledby={headingId}>
        <h2 id={headingId} className="section-title">
          Open a report file
        </h2>
        <div className="field">
          <label htmlFor={inputId} className="field__label">
            Report file
          </label>
          <input id={inputId} type="file" accept=".json,application/json" onChange={(e) => void onChange(e)} aria-describedby={hintId} />
        </div>
        <p id={hintId} className="hint">
          A JSON report from <code>design-warden check --report &lt;file&gt;</code> (or <code>--format json</code>), for any project. It is read in this
          browser and sent nowhere. Screenshots are not available in file mode: a report only names image files on the machine that produced it. Guidance
          links show their source path and section.
        </p>
      </section>
      {error && <Alert tone="danger">{error}</Alert>}
      {loaded ? (
        <section className="stack" aria-label={`Report from ${loaded.name}`}>
          <p className="hint">
            Showing <code>{loaded.name}</code>
          </p>
          <ReportView key={loaded.key} report={loaded.report} />
        </section>
      ) : (
        !error && <EmptyState title="No report loaded">Choose a JSON report file to inspect it.</EmptyState>
      )}
    </div>
  );
}
