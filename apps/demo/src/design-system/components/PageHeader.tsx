import type { ReactNode } from 'react';
import './PageHeader.css';

export interface PageHeaderProps {
  /** The page's only <h1>. */
  title: string;
  description?: string;
  /** At most one primary Button. */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__text">
        <h1 className="ds-page-header__title">{title}</h1>
        {description && <p className="ds-page-header__description">{description}</p>}
      </div>
      {actions && <div className="ds-page-header__actions">{actions}</div>}
    </header>
  );
}
