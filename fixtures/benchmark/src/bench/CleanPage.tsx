// Benchmark: a fully compliant page in the established style. Must produce no findings.
import { useState } from 'react';
import { Button, Card, DataTable, EmptyState, FilterBar, PageHeader, Select, Stack, TextField, type DataTableColumn } from '../design-system';
import './clean.css';

interface Invoice {
  id: string;
  customer: string;
  total: number;
}

const columns: DataTableColumn<Invoice>[] = [
  { key: 'id', header: 'Invoice' },
  { key: 'customer', header: 'Customer' },
  { key: 'total', header: 'Total', align: 'right' },
];

export function InvoicesPage({ rows, status }: { rows: Invoice[]; status: 'loading' | 'error' | 'ready' }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('open');
  return (
    <Stack gap={6}>
      <PageHeader title="Invoices" actions={<Button variant="primary">New invoice</Button>} />
      <Card>
        <Stack gap={5}>
          <FilterBar onReset={() => setQuery('')}>
            <TextField label="Search" type="search" value={query} onChange={setQuery} />
            <Select label="State" value={state} onChange={setState} options={[{ value: 'open', label: 'Open' }]} />
          </FilterBar>
          <DataTable
            caption="Invoices"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            status={status}
            emptyState={<EmptyState title="No invoices yet" description="Invoices appear here once you send one." />}
          />
          <p className="invoices-page__footnote">Totals include tax.</p>
        </Stack>
      </Card>
    </Stack>
  );
}
