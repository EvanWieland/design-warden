import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { Link } from './Link';
import './AppShell.css';

export interface AppShellProps {
  nav: readonly { to: string; label: string }[];
  /** The current page. */
  children: ReactNode;
}

export function AppShell({ nav, children }: AppShellProps) {
  return (
    <div className="ds-app-shell">
      <nav className="ds-app-shell__sidebar" aria-label="Main">
        <p className="ds-app-shell__product">Acme Console</p>
        <ul className="ds-app-shell__nav">
          {nav.map((item) => (
            <li key={item.to}>
              <Link to={item.to} variant="nav">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ds-app-shell__body">
        <header className="ds-app-shell__topbar">
          <span className="ds-app-shell__workspace">Acme Retail</span>
          <Badge tone="neutral">EU region</Badge>
        </header>
        <main className="ds-app-shell__main">{children}</main>
      </div>
    </div>
  );
}
