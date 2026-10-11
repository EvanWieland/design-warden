<!-- Benchmark: a local registration wins over a global one (vue-globals.ts registers AcmeBadge as the design system's Badge). No findings are expected. -->
<template>
  <AcmeBadge />
</template>

<script lang="ts">
import LegacyBadge from './LegacyBadge.vue';
export default { components: { AcmeBadge: LegacyBadge } };
</script>
