import { Badge, Card, DataTable, EmptyState, Link, PageHeader, Stack, StatCard, type DataTableColumn } from '../design-system';
import { formatCurrency, orderStatuses, orders, type Order } from '../data/orders';
import { PartnerPromo } from '../legacy/PartnerPromo';
import './OverviewPage.css';

const columns: DataTableColumn<Order>[] = [
  { key: 'id', header: 'Order' },
  { key: 'customer', header: 'Customer' },
  {
    key: 'status',
    header: 'Status',
    render: (order) => <Badge tone={orderStatuses[order.status].tone}>{orderStatuses[order.status].label}</Badge>,
  },
  { key: 'total', header: 'Total', align: 'right', render: (order) => formatCurrency(order.total) },
];

export function OverviewPage() {
  return (
    <Stack gap={6}>
      <PageHeader title="Overview" description="Order activity for Acme Retail, week of 6 October 2026" />
      <Stack direction="row" gap={4} wrap>
        <StatCard label="Open orders" value="128" change="+6.4%" trend="up" />
        <StatCard label="Revenue (7 days)" value="$48,210" change="+3.1%" trend="up" />
        <StatCard label="Late shipments" value="7" change="−2" trend="down" />
        <StatCard label="Return rate" value="2.4%" trend="flat" />
      </Stack>
      <p className="overview-page__late-note">7 shipments are late. Contact the carriers today.</p>
      <Card title="Recent orders" actions={<Link to="/orders">View all orders</Link>}>
        <DataTable
          caption="Recent orders"
          columns={columns}
          rows={orders.slice(0, 5)}
          rowKey={(order) => order.id}
          status="ready"
          emptyState={<EmptyState title="No orders yet" description="New orders appear here as soon as customers place them." />}
        />
      </Card>
      <PartnerPromo />
    </Stack>
  );
}
