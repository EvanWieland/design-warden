// Benchmark: cases from the 2026-10-10 false-positive/false-negative audit. Each "@expect <rule>" marker labels a finding expected on its line.
// A value the tool cannot resolve is expected as an "insufficient evidence" finding, which counts as reported.
import type { CSSProperties } from 'react';
import { Badge } from '../design-system';

const cell = { padding: '10px 14px', color: '#475569' }; /* @expect spacing/scale x2 @expect color/semantic-tokens */
const BY_STATUS: Record<string, CSSProperties> = {};

export function AuditCases({ on, c, s, t, m }: { on: boolean; c?: string; s: string; t: string; m: Record<string, 'info'> }) {
  return (
    <form>
      <p style={{ color: '#e11d48', padding: '10px' } as CSSProperties}>type cast</p> {/* @expect color/semantic-tokens @expect spacing/scale */}
      <p style={cell}>local constant, reported where it is defined</p>
      <p style={BY_STATUS[s]}>unknown object</p> {/* @expect color/semantic-tokens @expect spacing/scale @expect typography/scale */}
      <svg><path fill={on ? '#2563eb' : 'none'} /><path stroke={c ?? '#000'} /></svg> {/* @expect color/semantic-tokens x2 */}
      <input type="hidden" name="id" value="1" />
      <input type="radio" name="choice" />
      <input type={t} /> {/* @expect components/design-system-controls */}
      <div role="button" tabIndex={0}>Open</div> {/* @expect components/design-system-controls */}
      <Badge tone={m.x ?? 'default'}>fallback value</Badge> {/* @expect components/prop-contracts */}
    </form>
  );
}
