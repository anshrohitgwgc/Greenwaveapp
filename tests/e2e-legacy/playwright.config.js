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
  // Must be an origin the API's CORS allowlist actually contains. The API
  // allowlists `http://localhost:8080` for local development and deliberately
  // does NOT reflect arbitrary origins, so `127.0.0.1:8080` — a *different*
  // origin to the browser — is rejected at preflight and every login fails.
  // The fix belongs here, not in the allowlist.
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
