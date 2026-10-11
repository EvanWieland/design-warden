import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  Stack,
  TextField,
  type DataTableColumn,
  type SelectOption,
} from '../design-system';
import { formatCurrency, formatDate, orderStatuses, type Order, type OrderStatus } from '../data/orders';
import { useOrders } from '../data/useOrders';
import { navigate } from '../router';

const columns: DataTableColumn<Order>[] = [
  { key: 'id', header: 'Order' },
  { key: 'customer', header: 'Customer' },
  {
    key: 'status',
    header: 'Status',
    render: (order) => <Badge tone={orderStatuses[order.status].tone}>{orderStatuses[order.status].label}</Badge>,
  },
  { key: 'items', header: 'Items' },
  { key: 'total', header: 'Total', align: 'right', render: (order) => formatCurrency(order.total) },
  { key: 'placed', header: 'Placed', render: (order) => formatDate(order.placed) },
];

const statusOptions: SelectOption<OrderStatus | 'all'>[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'refunded', label: 'Refunded' },
];

export function OrdersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const result = useOrders({ search, status });

  function clearFilters() {
    setSearch('');
    setStatus('all');
  }

  return (
    <Stack gap={6}>
      <PageHeader
        title="Orders"
        description="Search, filter and follow up on customer orders."
        actions={
          <Button variant="primary" onClick={() => navigate('/orders/new')}>
            New order
          </Button>
        }
      />
      <Card>
        <Stack gap={5}>
          <FilterBar onReset={clearFilters}>
            <TextField label="Search" type="search" placeholder="Order or customer" value={search} onChange={setSearch} />
            <Select label="Status" value={status} onChange={setStatus} options={statusOptions} />
          </FilterBar>
          <DataTable
            caption="Orders"
            columns={columns}
            rows={result.rows}
            rowKey={(order) => order.id}
            status={result.status}
            errorMessage="The order service did not respond. Your filters are kept, so you can try again right away."
            onRetry={() => navigate('/orders')}
            emptyState={
              <EmptyState
                title="No orders match these filters"
                description="Try another search term or status, or clear the filters to see every order."
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            }
          />
        </Stack>
      </Card>
    </Stack>
  );
}
