import { defineConfig } from 'vitest/config';

// `pnpm test:pack`: the packaging test, kept out of `pnpm test` because it needs the network.
export default defineConfig({
  test: {
    include: ['tests/pack/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
