// Benchmark: re-implemented components. Each "@expect <rule>" marker labels a finding expected on its line.
// The last three definitions are deliberate traps: names that contain an alias but are not re-implementations.
import { Badge, Button, Card, Stack } from '../design-system';

export function CustomButton({ label }: { label: string }) { /* @expect components/reuse-existing */
  return <span role="button" className="custom-button">{label}</span>; /* @expect components/design-system-controls */
}

export function StatusChip({ text }: { text: string }) { /* @expect components/reuse-existing */
  return <span className="status-chip">{text}</span>;
}

export function SaveButton() {
  return <Button variant="primary">Save</Button>;
}

export function OrderTag({ text }: { text: string }) {
  return <Badge tone="neutral">{text}</Badge>;
}

export function SummaryPanel({ children }: { children: string }) {
  return <Card title="Summary">{children}</Card>;
}

// Trap: a notice board is a feed of announcements, not an Alert. "Notice" is an alias, but not the head noun.
export function NoticeBoard({ items }: { items: string[] }) {
  return <ul className="notice-board">{items.map((i) => <li key={i}>{i}</li>)}</ul>;
}

// Trap: a layout grid of panels, not a Card re-implementation. "Panel" is an alias, but not the head noun.
export function PanelGrid({ children }: { children: string }) {
  return <section className="panel-grid">{children}</section>;
}

// Trap: a pivot summary built from Stack, not a DataTable re-implementation. Its head noun "Table" is an
// alias, so the name heuristic flags it: an expected false positive that measures the heuristic's limit.
export function PivotTable({ rows }: { rows: [string, number][] }) {
  return <Stack gap={1}>{rows.map(([k, v]) => <span key={k}>{k}: {v}</span>)}</Stack>;
}
