const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright config for the legacy vanilla-JS Operations frontend
 * (repo root index.html / assets/*.js), served statically. This app talks to
 * the NestJS API directly (no dev-server proxy), so each test sets the
 * `greenwave.apiBase` localStorage override before navigating.
 */
module.exports = defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
