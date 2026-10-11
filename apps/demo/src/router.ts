import { useSyncExternalStore } from 'react';

// Fired after pushState, which (unlike back/forward) does not emit popstate.
const NAVIGATE_EVENT = 'acme:navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

const getSnapshot = () => window.location.pathname + window.location.search;

/** Current pathname and query string; re-renders on navigate() and on back/forward. */
export function useLocation(): { pathname: string; query: URLSearchParams } {
  const url = new URL(useSyncExternalStore(subscribe, getSnapshot), window.location.origin);
  return { pathname: url.pathname, query: url.searchParams };
}

/** Client-side navigation to an app path such as "/orders?state=empty". */
export function navigate(to: string) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo(0, 0);
}
