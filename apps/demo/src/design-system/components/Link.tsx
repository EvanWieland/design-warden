import type { MouseEvent, ReactNode } from 'react';
import { navigate, useLocation } from '../../router';
import './Link.css';

export interface LinkProps {
  /** App path, e.g. "/orders". */
  to: string;
  children: ReactNode;
  variant?: 'default' | 'nav';
}

export function Link({ to, children, variant = 'default' }: LinkProps) {
  const { pathname } = useLocation();
  // A nav link stays current on its child routes: "Orders" is current on /orders/new.
  const current = variant === 'nav' && (pathname === to || (to !== '/' && pathname.startsWith(`${to}/`)));

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Leave new-tab and new-window clicks to the browser.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} className={`ds-link ds-link--${variant}`} aria-current={current ? 'page' : undefined} onClick={handleClick}>
      {children}
    </a>
  );
}
