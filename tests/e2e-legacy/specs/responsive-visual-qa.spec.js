const fs = require('fs');
const path = require('path');
const { test, expect, request: pwRequest } = require('@playwright/test');
const { loginAs, API_BASE } = require('./helpers');

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, label: 'Mobile standard' },
  { name: '430x932', width: 430, height: 932, label: 'Mobile large' },
  { name: '768x1024', width: 768, height: 1024, label: 'Tablet portrait' },
  { name: '1366x768', width: 1366, height: 768, label: 'Desktop standard' },
  { name: '1920x1080', width: 1920, height: 1080, label: 'Desktop full HD' },
];

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', '..', 'test-results', 'responsive-visual-qa');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

/** No element should force the page wider than its own viewport. */
async function assertNoHorizontalOverflow(page, viewportWidth, context) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  // Small tolerance for scrollbar-width rounding across engines.
  expect(scrollWidth, `horizontal overflow at ${context}`).toBeLessThanOrEqual(viewportWidth + 2);
}

/**
 * At narrow viewports the sidebar nav goes off-canvas and is only reachable
 * via the hamburger toggle (#menuBtn -> .menu-open on #app). Desktop widths
 * hide #menuBtn entirely (nav is already on-screen), so this is a no-op
 * there.
 */
async function goToNav(page, view) {
  const menuBtn = page.locator('#menuBtn');
  if (await menuBtn.isVisible()) {
    await menuBtn.click();
  }
  await page.click(`.navitem[data-view="${view}"]`);
}

async function shoot(page, viewport, screenName) {
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${screenName}-${viewport.name}.png`),
    fullPage: true,
  });
}

let invoicePaymentPath = null;

test.beforeAll(async () => {
  // Set up one throwaway invoice + payment link via the real API so the
  // public Customer Payment Page has something real to render for the
  // screenshot pass below (no UI invoice-builder walkthrough needed).
  const api = await pwRequest.newContext({ baseURL: API_BASE });
  let invoiceStatus;
  let invoiceBody;
  let linkStatus = null;
  let linkBody = null;

  try {
    const loginRes = await api.post('/auth/login', {
      data: { email: 'admin@greenwave.local', password: 'DevPassword123!' },
    });
    const { access_token } = await loginRes.json();
    const authHeaders = { Authorization: `Bearer ${access_token}` };

    const invoiceRes = await api.post('/invoices', {
      headers: authHeaders,
      data: {
        invoiceDate: new Date().toISOString().slice(0, 10),
        // REQUIRED, not optional, for this account. admin@greenwave.local
        // holds *both* business divisions (migration 017 bootstraps every
        // existing admin with greenwave + healthcare), and the invoice API
        // refuses to guess for a multi-division actor — it answers
        // 400 "division is required" rather than silently defaulting, so a
        // typo can never widen access. GreenWave Recycling is the correct
        // division for this fixture: it bills an ordinary recycling line
        // item out of the Calgary warehouse, and every pre-existing invoice
        // in the system is likewise recycling (migration 017 backfilled the
        // column that way). `greenwave` is the canonical key the API
        // accepts; it is persisted as the legacy storage value `recycling`
        // by the boundary translation in divisions.constants.ts.
        division: 'greenwave',
        // Deliberately free-text billing details with no customerId, no
        // materialId and no product reference, so this invoice owns every
        // field the payment page renders and there is no second
        // division-scoped record that could disagree with it. (The invoice
        // API cross-checks a linked customer's division —
        // assertCustomerInDivision — and the public /pay/:token payload
        // renders the invoice's own billTo column, not a customer join.)
        billTo: 'Visual QA Customer\n123 Test St, Calgary, AB',
        // Calgary. Division-agnostic: every warehouse carries both
        // divisions, so this only has to satisfy warehouse authorization,
        // which this admin holds.
        warehouseId: '22222222-2222-4222-8222-222222222222',
        items: [
          {
            description: 'Visual QA line item',
            quantity: 1,
            unitPrice: 100,
          },
        ],
      },
    });
    invoiceStatus = invoiceRes.status();
    invoiceBody = await invoiceRes.text();

    if (invoiceRes.ok()) {
      const invoice = JSON.parse(invoiceBody);
      const linkRes = await api.post(`/payments/invoices/${invoice.id}/link`, {
        headers: authHeaders,
      });
      linkStatus = linkRes.status();
      linkBody = await linkRes.text();

      if (linkRes.ok()) {
        const link = JSON.parse(linkBody);
        // Use the hash-route form (#pay/<token>), same as the app's own "Copy
        // Payment Link" button builds: the hash never reaches the server, so
        // it works when served by a plain static file server (serve.sh /
        // python http.server has no SPA rewrite rule, unlike production
        // nginx's `try_files ... /index.html`). The raw /pay/<token> path
        // 404s in that environment even though the app supports it fine.
        const token = String(link.paymentUrl || '').replace(/^\/?pay\//, '').split('?')[0];
        invoicePaymentPath = '/#pay/' + token;
      }
    }
  } finally {
    await api.dispose();
  }

  // Fail the setup loudly instead of leaving invoicePaymentPath null. The
  // old version swallowed both non-2xx responses, which is how a real API
  // contract change (division became mandatory for multi-division accounts)
  // surfaced as five quietly *skipped* Customer payment page tests instead
  // of a red suite.
  expect(
    invoicePaymentPath,
    `payment-link fixture setup failed — POST /invoices -> ${invoiceStatus} ${invoiceBody}` +
      (linkStatus === null ? '' : `; POST /payments/invoices/:id/link -> ${linkStatus} ${linkBody}`),
  ).toBeTruthy();
});

for (const viewport of VIEWPORTS) {
  test.describe(`Responsive @ ${viewport.name} (${viewport.label})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Login page renders without horizontal overflow or broken controls', async ({ page }) => {
      await page.addInitScript((base) => {
        window.localStorage.setItem('greenwave.apiBase', base);
      }, API_BASE);
      await page.goto('/');
      await page.waitForSelector('#gate');
      await expect(page.locator('#gateEmail')).toBeVisible();
      await expect(page.locator('#gatePassword')).toBeVisible();
      await expect(page.locator('#signSubmit')).toBeVisible();
      await assertNoHorizontalOverflow(page, viewport.width, 'Login');
      await shoot(page, viewport, 'login');
    });

    test('Dashboard renders without horizontal overflow', async ({ page }) => {
      await loginAs(page, 'admin@greenwave.local');
      await page.waitForSelector('#v-dashboard.view.active');
      await page.waitForSelector('#dashRecentActivity .tablewrap, #dashRecentActivity .empty');
      await expect(page.locator('#dashboardKpis .kpi-card').first()).toBeVisible();
      await assertNoHorizontalOverflow(page, viewport.width, 'Dashboard');
      await shoot(page, viewport, 'dashboard');
    });

    test('Inventory renders without horizontal overflow', async ({ page }) => {
      await loginAs(page, 'admin@greenwave.local');
      await goToNav(page, 'inventory');
      await page.waitForSelector('#v-inventory.view.active');
      await page.waitForSelector('#invenBody .table, #invenBody .empty');
      await expect(page.locator('#btnReceiveStock')).toBeVisible();
      await assertNoHorizontalOverflow(page, viewport.width, 'Inventory');
      await shoot(page, viewport, 'inventory');
    });

    test('Invoices list renders without horizontal overflow', async ({ page }) => {
      await loginAs(page, 'admin@greenwave.local');
      await goToNav(page, 'invoices');
      await page.waitForSelector('#v-invoices.view.active');
      await assertNoHorizontalOverflow(page, viewport.width, 'Invoices');
      await shoot(page, viewport, 'invoices');
    });

    test('Staff (Management Portal) view renders without horizontal overflow', async ({ page }) => {
      await loginAs(page, 'admin@greenwave.local');
      await goToNav(page, 'staff');
      await page.waitForSelector('#v-staff.view.active');
      await assertNoHorizontalOverflow(page, viewport.width, 'Staff/Management Portal');
      await shoot(page, viewport, 'management-portal-staff');
    });

    test('Customer payment page renders without horizontal overflow', async ({ page }) => {
      // This test navigates straight to the payment route without going
      // through loginAs(), so (unlike every other test in this file) it
      // never gets the `greenwave.apiBase` localStorage override set. Each
      // Playwright test starts a brand-new browser context, so nothing
      // persists from earlier tests either. Without the override, api.js
      // falls back to same-origin (http://127.0.0.1:8080, the static file
      // server) instead of the real API (http://127.0.0.1:4000), and
      // GET /pay/:token 404s against the file server before the page ever
      // has real invoice data to render.
      await page.addInitScript((base) => {
        window.localStorage.setItem('greenwave.apiBase', base);
      }, API_BASE);
      await page.goto(invoicePaymentPath);
      // Assert the real payment document renders, not just that *a* page
      // loaded — `#gate, #app, body` would trivially match a 404 error page
      // too and mask a broken link. Wait for the totals box, which only
      // exists after Api.getPublicInvoice() resolves with real data (the
      // pre-fetch state is a bare spinner with no invoice markup at all).
      await page.waitForSelector('#payPortal:not([hidden])', { timeout: 10000 });
      await page.waitForSelector('.payportal-totals-box', { timeout: 10000 });
      await expect(page.locator('.payportal-inv-num')).toBeVisible();
      await expect(page.locator('.payportal-inv-num')).not.toHaveText(/12345/);
      await expect(page.locator('.payportal-logo')).toBeVisible();
      await assertNoHorizontalOverflow(page, viewport.width, 'Customer payment page');
      await shoot(page, viewport, 'customer-payment-page');
    });
  });
}
