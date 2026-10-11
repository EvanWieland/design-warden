<!-- Benchmark: a script binding wins over a global registration (vue-globals.ts registers acme-table as the design system's DataTable). No findings are expected. -->
<template>
  <AcmeTable />
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
const AcmeTable = defineAsyncComponent(() => import('./LegacyTable.vue'));
</script>
