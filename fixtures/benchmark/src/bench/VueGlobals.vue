<!-- Benchmark: globally registered design-system components (vue-globals.ts). Each "@expect <rule>" marker labels a finding expected on its line. -->
<template>
  <section>
    <!-- Tricky negatives: required props given, in both tag spellings. -->
    <acme-badge tone="info">Live</acme-badge>
    <AcmeTable :rows="rows" status="ready" :empty-state="empty" />

    <AcmeBadge>Late</AcmeBadge> <!-- @expect components/prop-contracts -->
    <acme-table :rows="rows" /> <!-- @expect components/prop-contracts x2 -->
    <ns-badge>Late</ns-badge> <!-- @expect components/prop-contracts -->
  </section>
</template>

<script setup lang="ts">
defineProps<{ rows: unknown[]; empty: string }>();
</script>
