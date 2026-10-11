import { useEffect, type ReactNode } from 'react';
import { AppShell, Card, EmptyState, Link, PageHeader, Stack } from './design-system';
import { NewOrderPage } from './pages/NewOrderPage';
import { OrdersPage } from './pages/OrdersPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { useLocation } from './router';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/orders', label: 'Orders' },
  { to: '/settings', label: 'Settings' },
];

function route(pathname: string): { title: string; page: ReactNode } {
  switch (pathname) {
    case '/':
      return { title: 'Overview', page: <OverviewPage /> };
    case '/orders':
      return { title: 'Orders', page: <OrdersPage /> };
    case '/orders/new':
      return { title: 'New order', page: <NewOrderPage /> };
    case '/settings':
      return { title: 'Settings', page: <SettingsPage /> };
    default:
      return {
        title: 'Page not found',
        page: (
          <Stack gap={6}>
            <PageHeader title="Page not found" />
            <Card>
              <EmptyState
                title="This page does not exist"
                description="Check the address for typos, or go back to the overview."
                action={<Link to="/">Go to the overview</Link>}
              />
            </Card>
          </Stack>
        ),
      };
  }
}

export function App() {
  const { pathname } = useLocation();
  const { title, page } = route(pathname);

  useEffect(() => {
    document.title = `${title} · Acme Console`;
  }, [title]);

  return <AppShell nav={NAV}>{page}</AppShell>;
}
