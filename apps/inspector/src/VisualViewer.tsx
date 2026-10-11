import { useState } from 'react';
import type { Box, VisualDiffSummary } from '@design-warden/core';
import { artifactUrl } from './api.ts';
import { formatPct, toneOf } from './format.ts';
import { Alert, Badge, Dialog, Segmented } from './ui.tsx';

type ImageKind = 'before' | 'after' | 'diff';
const KINDS: { value: ImageKind; label: string }[] = [
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'diff', label: 'Diff' },
];

const sameBox = (a: Box, b?: Box) => !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Before / after / diff of one capture with the changed regions drawn over each image. */
export function VisualViewer(props: { runId: string; diff: VisualDiffSummary; focus?: Box; onClose: () => void }) {
  const { diff, focus } = props;
  const [shown, setShown] = useState<ImageKind>('diff');
  return (
    <Dialog title={`Visual change: ${diff.capture}`} onClose={props.onClose}>
      <p className="viewer__meta">
        <Badge tone={toneOf(diff.status)}>{diff.status}</Badge> {formatPct(diff.changedRatio)} of pixels changed ({diff.changedPixels} px),{' '}
        {diff.regions.length} region(s).{focus && ' The region cited as evidence is outlined in black.'}
      </p>
      {diff.error && <Alert tone="danger">{diff.error}</Alert>}
      <Segmented className="viewer__toggle" legend="Image to show" value={shown} options={KINDS} onChange={setShown} />
      <div className="viewer__images">
        {KINDS.map(({ value, label }) => {
          const path = diff.images[value];
          return (
            <Shot
              key={value}
              label={label}
              capture={diff.capture}
              src={path && artifactUrl(props.runId, path)}
              regions={diff.regions}
              focus={focus}
              hiddenOnMobile={value !== shown}
            />
          );
        })}
      </div>
      <section className="viewer__regions" aria-label="Changed regions">
        {diff.regions.length === 0 ? (
          <p className="hint">No changed regions were reported for this capture.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="table__caption">Changed regions (numbered as on the images; image pixels)</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Nearest element</th>
                  <th scope="col">Position</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {diff.regions.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {i + 1}
                      {sameBox(r, focus) && ' (evidence)'}
                    </td>
                    <td>{r.label ? <code>{r.label}</code> : 'unknown'}</td>
                    <td>
                      {r.x}, {r.y}
                    </td>
                    <td>
                      {r.width} × {r.height}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Dialog>
  );
}

function Shot(props: { label: string; capture: string; src?: string; regions: Box[]; focus?: Box; hiddenOnMobile: boolean }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const { src, label } = props;
  return (
    <figure className={`viewer__shot${props.hiddenOnMobile ? ' viewer__shot--off' : ''}`}>
      <figcaption className="viewer__caption">
        <span>{label}</span>
        {src && !failed && (
          <a href={src} target="_blank" rel="noreferrer">
            Open full size<span className="visually-hidden"> ({label.toLowerCase()} image)</span>
          </a>
        )}
      </figcaption>
      {!src ? (
        <p className="hint">No {label.toLowerCase()} image for this capture.</p>
      ) : failed ? (
        <Alert tone="danger">The {label.toLowerCase()} image could not be loaded.</Alert>
      ) : (
        <div className="shot">
          <img
            src={src}
            alt={`${label}: ${props.capture}`}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
          />
          {size &&
            props.regions.map((r, i) => (
              // Numbered like the regions table, which carries the element labels (full names overlap at this scale).
              <span
                key={i}
                aria-hidden="true"
                title={r.label}
                className={`shot__region${sameBox(r, props.focus) ? ' shot__region--focus' : ''}`}
                // Computed geometry: region pixels as a share of the image's natural size, so boxes follow the displayed size.
                style={{
                  left: `${(r.x / size.w) * 100}%`,
                  top: `${(r.y / size.h) * 100}%`,
                  width: `${(r.width / size.w) * 100}%`,
                  height: `${(r.height / size.h) * 100}%`,
                }}
              >
                <span className="shot__label">{i + 1}</span>
              </span>
            ))}
        </div>
      )}
    </figure>
  );
}
