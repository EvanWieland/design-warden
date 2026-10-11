import type { ReactNode } from 'react';
import './Alert.css';

export interface AlertProps {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
  /** Usually one small Button, e.g. "Try again". */
  action?: ReactNode;
}

/** Danger alerts interrupt screen readers (role="alert"); other tones are announced politely. */
export function Alert({ tone, title, children, action }: AlertProps) {
  return (
    <div className={`ds-alert ds-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="ds-alert__content">
        {title && <p className="ds-alert__title">{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="ds-alert__action">{action}</div>}
    </div>
  );
}
