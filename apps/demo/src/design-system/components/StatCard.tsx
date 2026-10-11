import { Badge } from './Badge';
import './StatCard.css';

const ARROWS = { up: '↑', down: '↓', flat: '→' } as const;

export interface StatCardProps {
  label: string;
  /** Pre-formatted, e.g. "$48,210". */
  value: string | number;
  /** Pre-formatted change for the period, e.g. "+6.4%". */
  change?: string;
  trend?: 'up' | 'down' | 'flat';
}

/** The trend badge shows direction, not judgement: a falling number can be good news. */
export function StatCard({ label, value, change, trend }: StatCardProps) {
  return (
    <div className="ds-stat-card">
      <p className="ds-stat-card__label">{label}</p>
      <p className="ds-stat-card__value">{value}</p>
      {trend && (
        <Badge tone={trend === 'flat' ? 'neutral' : 'info'}>
          <span aria-hidden="true">{ARROWS[trend]}</span>
          {change ?? 'No change'}
        </Badge>
      )}
    </div>
  );
}
