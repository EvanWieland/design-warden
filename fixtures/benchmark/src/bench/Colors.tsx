// Benchmark: colors in TSX (inline styles, color props, data). Each "@expect <rule>" marker labels a finding expected on its line.
import { Badge, Stack } from '../design-system';

const BRAND_HEX = '#ff6a00'; // a data constant is not a style; it is only a finding where it is applied

export function ColorCases({ accent, highlighted }: { accent: string; highlighted: boolean }) {
  return (
    <Stack gap={3}>
      <p style={{ color: 'var(--color-text-secondary)' }}>ok: token in an inline style</p>
      <p style={{ color: '#b91c1c' }}>literal hex</p> {/* @expect color/semantic-tokens */}
      <p style={{ backgroundColor: 'white' }}>named color</p> {/* @expect color/semantic-tokens */}
      <p style={{ borderColor: accent }}>runtime value</p> {/* @expect color/semantic-tokens */}
      <p style={{ color: highlighted ? '#dc2626' : 'var(--color-text-primary)' }}>one literal branch</p> {/* @expect color/semantic-tokens */}
      <svg aria-hidden="true"><path fill="#000" d="M0 0h1v1z" /></svg> {/* @expect color/semantic-tokens */}
      <svg aria-hidden="true"><path fill="currentColor" d="M0 0h1v1z" /></svg>
      <Badge tone="info">ok: tone, not a color</Badge>
      <span data-brand={BRAND_HEX}>ok: not a style</span>
    </Stack>
  );
}
