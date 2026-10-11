<!-- Benchmark: a Vue single-file component. Each "@expect <rule>" marker labels a finding expected on its line. -->
<!-- A value the tool cannot resolve is expected as an "insufficient evidence" finding, which counts as reported. -->
<template>
  <Card>
    <!-- Tricky negatives: tokens, required props given (kebab-case and same-name shorthand too), bound values, a spread, a global component. -->
    <Stack :gap="4">
      <Badge tone="info">Live</Badge>
      <Badge :tone>Status</Badge>
      <DataTable :rows="rows" status="ready" :empty-state="empty" />
      <p class="text-[color:var(--color-text-secondary)]" style="padding: var(--space-2)">Synced</p>
      <RouterLink to="/orders">Orders</RouterLink>
      <Button v-bind="buttonProps">Save</Button>
    </Stack>

    <button type="button" @click="reload">Reload</button> <!-- @expect components/design-system-controls -->
    <Badge>Late</Badge> <!-- @expect components/prop-contracts -->
    <p style="color: #b91c1c">Overdue</p> <!-- @expect color/semantic-tokens -->
    <p :style="{ marginTop: offset }">Note</p> <!-- @expect spacing/scale -->
    <span class="px-[13px]">Tag</span> <!-- @expect spacing/scale -->
    <DS.Badge>Late</DS.Badge> <!-- @expect components/prop-contracts -->
    <p style="display: none !important">Hidden</p> <!-- @expect styles/no-important -->
  </Card>
</template>

<script setup lang="ts">
import { Badge, Button, Card, DataTable, Stack } from '../design-system';
import * as DS from '../design-system';
defineProps<{ rows: unknown[]; empty: string; offset: number; tone: string; buttonProps: Record<string, unknown>; reload: () => void }>();
</script>

<style scoped>
.vue-orders { padding: var(--space-4); }
.vue-orders__late { margin-block: 18px; } /* @expect spacing/scale */
.vue-orders__pinned { position: sticky !important; } /* @expect styles/no-important */
</style>
