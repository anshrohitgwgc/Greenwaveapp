import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright test configuration targeting the local GreenWave V2 UI.
 * - baseURL points to the Vite dev server (http://127.0.0.1:5173).
 * - timeout set to 30 seconds for each test.
 * - projects cover multiple viewports for responsive testing.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
