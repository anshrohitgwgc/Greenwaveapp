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
  const loginRes = await api.post('/auth/login', {
    data: { email: 'admin@greenwave.local', password: 'DevPassword123!' },
  });
  const { access_token } = await loginRes.json();
  const authHeaders = { Authorization: `Bearer ${access_token}` };

  const invoiceRes = await api.post('/invoices', {
    headers: authHeaders,
    data: {
      invoiceDate: new Date().toISOString().slice(0, 10),
      billTo: 'Visual QA Customer\n123 Test St, Calgary, AB',
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
  if (invoiceRes.ok()) {
    const invoice = await invoiceRes.json();
    const linkRes = await api.post(`/payments/invoices/${invoice.id}/link`, {
      headers: authHeaders,
    });
    if (linkRes.ok()) {
      const link = await linkRes.json();
      invoicePaymentPath = link.paymentUrl;
    }
  }
  await api.dispose();
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

    test('Dashboard/Inventory renders without horizontal overflow', async ({ page }) => {
      await loginAs(page, 'admin@greenwave.local');
      await goToNav(page, 'inventory');
      await page.waitForSelector('#v-inventory.view.active');
      await page.waitForSelector('#invenBody .table, #invenBody .empty');
      await expect(page.locator('#btnReceiveStock')).toBeVisible();
      await assertNoHorizontalOverflow(page, viewport.width, 'Inventory/Dashboard');
      await shoot(page, viewport, 'dashboard-inventory');
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
      test.skip(!invoicePaymentPath, 'No payment link available (invoice/link API call failed in beforeAll)');
      await page.goto(invoicePaymentPath);
      await page.waitForSelector('#gate, #app, body', { timeout: 10000 });
      await assertNoHorizontalOverflow(page, viewport.width, 'Customer payment page');
      await shoot(page, viewport, 'customer-payment-page');
    });
  });
}
