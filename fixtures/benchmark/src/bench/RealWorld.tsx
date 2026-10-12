// Benchmark: patterns from running Design Warden on Excalidraw, VitePress and shadcn/ui (2026-10-12).
// Each "@expect <rule>" marker labels a finding expected on its line; unmarked lines are tricky negatives.
import Btn from '../design-system/components/Button';
import { Badge, Button, Card } from '../design-system';

declare const Toaster: (p: { toastOptions: object }) => null;
declare const Popover: (p: { render: unknown }) => null;

// A chart sets its colors at runtime as --chart-<key>, and a slider sets --thumb-x: references to them are not undefined tokens.
export const chartCss = (key: string, color: string) => `--chart-${key}: ${color};`;
export const moveThumb = (el: HTMLElement, x: number) => el.style.setProperty('--thumb-x', `${x}px`);

export function RealWorldCases({ busy, c, k }: { busy: boolean; c: number; k: string }) {
  return (
    <Card>
      <svg viewBox="0 0 10 10"><clipPath id="clip"><path fill="#fff" d="M0 0h10v10H0z" /></clipPath><path fill="var(--chart-desktop)" d="M0 0h5v5H0z" /></svg>
      <svg viewBox="0 0 10 10"><path fill="#123456" d="M0 0h5v5H0z" /></svg> {/* @expect color/semantic-tokens */}
      <circle style={{ strokeDasharray: `${c} ${c}`, strokeWidth: c, borderRadius: c }} />
      <i style={busy ? { visibility: 'hidden' } : {}} />
      <b style={busy ? { color: '#dc2626' } : undefined} /> {/* @expect color/semantic-tokens */}
      <div style={{ ['--card-accent' as string]: '#0ea5e9', [`--tone-${k}`]: 'var(--color-text-primary)' }} /> {/* @expect color/semantic-tokens */}
      <div style={{ transform: 'translateX(var(--thumb-x))', top: 'var(--layout-top-height, 0px)', boxShadow: 'var(--shadow-overlay-3)' }} /> {/* @expect tokens/semantic-only */}
      <div style={{ color: 'rgb(from var(--color-text-primary) r g b / 50%)', background: 'var(--color-bg-surfce, white)' }} /> {/* @expect tokens/semantic-only @expect color/semantic-tokens */}
      <Badge tone="info" color="lime">New</Badge>
      <Toaster toastOptions={{ className: 'ml-[13px]' }} /> {/* @expect spacing/scale */}
      <p className="p-[calc(13px+2px)] bg-taupe-500" /> {/* @expect spacing/scale x2 @expect tokens/semantic-only */}
      <Button render={<a href="/orders" />} />
      <Button asChild><a href="/orders">Orders</a></Button>
      <Popover render={<button type="button" />} /> {/* @expect components/design-system-controls */}
      <Btn variant="link">More</Btn> {/* @expect components/prop-contracts */}
    </Card>
  );
}

// Composition through a component of the same file is not a re-implementation; a raw table is.
function StatusPillInner() { return <Badge tone="info">Live</Badge>; }
export function StatusPill() { return <StatusPillInner />; }
export function OrdersTable() { return <table />; } // @expect components/reuse-existing @expect components/design-system-controls
