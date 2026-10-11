// Benchmark: Vue components registered globally, as a main.ts does. VueGlobals.vue uses them without importing them.
// No findings are expected in this file.
import { createApp } from 'vue';
import { Badge, DataTable } from '../design-system';
import * as DS from '../design-system';

declare const App: object;
createApp(App).component('AcmeBadge', Badge).component('acme-table', DataTable).component('NsBadge', DS.Badge).mount('#app');
