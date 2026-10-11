import { Card, DataTable, PageHeader, Stack, type DataTableColumn } from '../design-system';
import { formatCurrency, orders } from '../data/orders';

interface CustomerRow {
  name: string;
  orders: number;
  total: number;
}

const customers: CustomerRow[] = Object.values(
  orders.reduce<Record<string, CustomerRow>>((acc, order) => {
    const row = (acc[order.customer] ??= { name: order.customer, orders: 0, total: 0 });
    row.orders += 1;
    row.total += order.total;
    return acc;
  }, {}),
);

const columns: DataTableColumn<CustomerRow>[] = [
  { key: 'name', header: 'Customer' },
  { key: 'orders', header: 'Orders', align: 'right' },
  { key: 'total', header: 'Total spent', align: 'right', render: (row) => formatCurrency(row.total) },
];

export function CustomersPage() {
  return (
    <Stack gap={6}>
      <PageHeader title="Customers" description="Everyone who ordered in the last 30 days." />
      <Card>
        <DataTable caption="Customers" columns={columns} rows={customers} rowKey={(row) => row.name} />
      </Card>
    </Stack>
  );
}
