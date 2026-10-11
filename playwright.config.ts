import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the two web apps. Both are built first and served the way a user runs
 * them: the inspector by its own loopback service, the demo by `vite preview`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'corepack pnpm --filter @design-warden/inspector build && node apps/inspector/server/main.ts --port 4401',
      url: 'http://127.0.0.1:4401/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'corepack pnpm --filter @design-warden/demo build && corepack pnpm --filter @design-warden/demo preview --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
