import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  /** What is empty, e.g. "No orders match these filters". */
  title: string;
  /** Why, and what the user can do next. */
  description?: string;
  /** Usually one secondary Button or a Link. */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ds-empty-state">
      <h2 className="ds-empty-state__title">{title}</h2>
      {description && <p className="ds-empty-state__description">{description}</p>}
      {action && <div className="ds-empty-state__action">{action}</div>}
    </div>
  );
}
