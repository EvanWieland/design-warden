// Benchmark: spacing in inline styles. Each "@expect <rule>" marker labels a finding expected on its line.
import { Stack } from '../design-system';

export function SpacingCases({ size }: { size: number }) {
  return (
    <Stack gap={4}>
      <div style={{ padding: 'var(--space-4)' }}>ok: token</div>
      <div style={{ marginTop: 0 }}>ok: zero</div>
      <div style={{ padding: 12 }}>React number is px</div> {/* @expect spacing/scale */}
      <div style={{ gap: '6px' }}>string px</div> {/* @expect spacing/scale */}
      <div style={{ margin: size }}>runtime value</div> {/* @expect spacing/scale */}
    </Stack>
  );
}
