<!-- Benchmark: a Svelte component. Each "@expect <rule>" marker labels a finding expected on its line. -->
<!-- A value the tool cannot resolve is expected as an "insufficient evidence" finding, which counts as reported. -->
<script lang="ts">
  import { Badge, Button, Card, DataTable, Stack } from '../design-system';
  import * as DS from '../design-system';
  let { rows, empty, offset, buttonProps, late } = $props();
</script>

<Card>
  <!-- Tricky negatives: tokens, required props given (shorthand and a snippet too), bound values, a spread, a block, a class directive with a token. -->
  <Stack gap={4}>
    <Badge tone="info">Live</Badge>
    <DataTable {rows} status="ready" emptyState={empty} />
    <DataTable {rows} status="ready">{#snippet emptyState()}<p>None</p>{/snippet}</DataTable>
    <p class="text-[color:var(--color-text-secondary)]" style:padding="var(--space-2)">Synced</p>
    {#if late}<Button {...buttonProps}>Save</Button>{/if}
    <span class:px-[var(--space-1)]={late}>Tag</span>
  </Stack>

  <button type="button">Reload</button> <!-- @expect components/design-system-controls -->
  <Badge>Late</Badge> <!-- @expect components/prop-contracts -->
  <p style="color: #b91c1c">Overdue</p> <!-- @expect color/semantic-tokens -->
  <p style:margin-top={offset}>Note</p> <!-- @expect spacing/scale -->
  <span class="px-[13px] {late ? 'late' : ''}">Tag</span> <!-- @expect spacing/scale -->
  <DS.Badge>Late</DS.Badge> <!-- @expect components/prop-contracts -->
  <p style="color: #b91c1c; padding: {offset}px">Mixed</p> <!-- @expect color/semantic-tokens @expect spacing/scale -->
</Card>

<style>
  .svelte-orders { padding: var(--space-4); }
  .svelte-orders__late { margin-block: 18px; } /* @expect spacing/scale */
</style>
