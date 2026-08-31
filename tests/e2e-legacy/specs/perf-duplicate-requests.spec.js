const { test, expect } = require('@playwright/test');
const { loginAs, goToView } = require('./helpers');

// Lightweight real-network check: on first load of a screen, the same GET
// endpoint should not be requested more than once (a common React/vanilla-JS
// "forgot to memoize/guard the effect" bug that wastes API capacity).
async function countRequests(page) {
  const counts = {};
  page.on('request', (req) => {
    if (req.method() !== 'GET') return;
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/') || url.port !== '4000') return;
    const key = url.pathname;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

test.describe('Performance — no duplicate GET requests on first screen load', () => {
  const screens = ['dashboard', 'inventory', 'history', 'products', 'customers', 'staff', 'photos', 'chat', 'invoices'];

  for (const view of screens) {
    test(`${view}: no endpoint fetched more than once`, async ({ page }) => {
      await loginAs(page, 'admin@greenwave.local');
      const counts = await countRequests(page);
      await goToView(page, view);
      await page.waitForTimeout(700);
      const dupes = Object.entries(counts).filter(([, n]) => n > 1);
      expect(dupes, `Duplicate GET requests on ${view}: ${JSON.stringify(dupes)}`).toEqual([]);
    });
  }
});
