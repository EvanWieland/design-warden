import type { Location } from '@design-warden/core';
import type { Tone } from './ui.tsx';

/** Status words from reports and runs, mapped to badge tones. Unknown words (untrusted files) stay neutral. */
const TONES: Record<string, Tone> = {
  // overall and finding outcomes
  pass: 'success',
  fail: 'danger',
  review: 'warning',
  info: 'info',
  error: 'error',
  // engine statuses and progress events
  completed: 'success',
  started: 'info',
  skipped: 'neutral',
  failed: 'danger',
  incomplete: 'warning',
  // provenance classes
  established: 'success',
  modified: 'info',
  novel: 'warning',
  'insufficient-evidence': 'neutral',
  // visual capture statuses
  changed: 'warning',
  added: 'info',
  removed: 'info',
  'size-changed': 'warning',
};
export const toneOf = (word: unknown): Tone => TONES[String(word)] ?? 'neutral';

export const VERDICT_LABEL: Record<string, string> = {
  violation: 'Confirmed',
  'probable-violation': 'Probable',
  'insufficient-evidence': 'Insufficient evidence',
  'acceptable-deviation': 'Acceptable deviation',
  notice: 'Notice',
};

export const ORIGIN_LABEL: Record<string, string> = {
  deterministic: 'Deterministic',
  heuristic: 'Heuristic',
  ai: 'AI — advisory, never blocks',
};

export const ENGINE_LABEL: Record<string, string> = { source: 'Source', visual: 'Visual', semantic: 'Semantic (AI)', policy: 'Policy' };

export const STATUS_LABEL: Record<string, string> = { completed: 'Completed', skipped: 'Skipped', failed: 'Failed', incomplete: 'Incomplete' };

export const upper = (word: unknown) => String(word).toUpperCase();

export const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export const formatPct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

export const formatLocation = (l: Pick<Location, 'file' | 'line' | 'endLine'>) =>
  `${l.file}:${l.line}${l.endLine && l.endLine !== l.line ? `–${l.endLine}` : ''}`;
