// Benchmark: component prop contracts. Each "@expect <rule>" marker labels a finding expected on its line.
import { Alert, Badge, Button, DataTable, EmptyState, Stack } from '../design-system';
import * as DS from '../design-system';

type Row = { id: string };
const rows: Row[] = [];

export function ContractCases({ tone, rest }: { tone: 'info' | 'danger'; rest: object }) {
  return (
    <Stack gap={4}>
      <DataTable caption="ok" columns={[]} rows={rows} rowKey={(r) => r.id} status="ready" emptyState={<EmptyState title="None" />} />
      <DataTable caption="no states" columns={[]} rows={rows} rowKey={(r) => r.id} /> {/* @expect components/prop-contracts x2 */}
      <DataTable caption="bad status" columns={[]} rows={rows} rowKey={(r) => r.id} status="done" emptyState={null} /> {/* @expect components/prop-contracts */}
      <Button variant="link">not an approved variant</Button> {/* @expect components/prop-contracts */}
      <Button variant="ghost">ok</Button>
      <Badge tone={tone}>ok: runtime value is not judged</Badge>
      <Badge>missing tone</Badge> {/* @expect components/prop-contracts */}
      <DS.Alert tone="critical">namespace import</DS.Alert> {/* @expect components/prop-contracts */}
      <Alert tone="warning">ok</Alert>
      <Stack gap={9}>not on the spacing scale</Stack> {/* @expect components/prop-contracts */}
      <DataTable caption="spread" columns={[]} rows={rows} rowKey={(r) => r.id} {...rest} /> {/* @expect components/prop-contracts x2 */}
    </Stack>
  );
}
