import { useId, type ReactNode } from 'react';
import './Card.css';

export interface CardProps {
  title?: string;
  /** Shown at the end of the header, e.g. a Link to the full list. */
  actions?: ReactNode;
  children: ReactNode;
}

export function Card({ title, actions, children }: CardProps) {
  const titleId = useId();

  return (
    <section className="ds-card" aria-labelledby={title ? titleId : undefined}>
      {(title || actions) && (
        <header className="ds-card__header">
          {title && (
            <h2 id={titleId} className="ds-card__title">
              {title}
            </h2>
          )}
          {actions && <div className="ds-card__actions">{actions}</div>}
        </header>
      )}
      <div className="ds-card__body">{children}</div>
    </section>
  );
}
