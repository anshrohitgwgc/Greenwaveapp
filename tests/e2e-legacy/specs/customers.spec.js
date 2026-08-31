const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

async function selectFacility(page, label) {
  await page.selectOption('#wh', { label });
}

test.describe('Customers', () => {
  test('list renders, create works, and the new customer persists after reload', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="customers"]');
    await page.waitForSelector('#v-customers.view.active');
    await page.waitForSelector('#customerBody .table, #customerBody .empty');

    const uniqueName = 'E2E Customer ' + Date.now();
    await page.click('#newCustomer');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await expect(page.locator('#modalTitle')).toContainText('Add Customer');

    const form = page.locator('#modalForm');
    await form.locator('input[name="name"]').fill(uniqueName);
    await form.locator('textarea[name="billTo"]').fill('123 E2E Test St\nCalgary, AB');
    await form.locator('textarea[name="shipTo"]').fill('456 E2E Ship Ave\nCalgary, AB');
    await form.locator('input[name="email"]').fill('e2e-customer@example.test');

    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect(page.locator('#customerBody')).toContainText(uniqueName);

    await page.reload();
    await page.click('.navitem[data-view="customers"]');
    await page.waitForSelector('#v-customers.view.active');
    await page.waitForSelector('#customerBody .table, #customerBody .empty');
    await expect(page.locator('#customerBody')).toContainText(uniqueName);
  });

  test('a customer added to one facility does not appear when scoped to a different facility', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="customers"]');
    await page.waitForSelector('#v-customers.view.active');

    await selectFacility(page, 'Calgary, AB');
    await page.waitForSelector('#customerBody .table, #customerBody .empty');

    const isolatedName = 'E2E Isolated Customer ' + Date.now();
    await page.click('#newCustomer');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const form = page.locator('#modalForm');
    await form.locator('input[name="name"]').fill(isolatedName);
    await form.locator('textarea[name="billTo"]').fill('Calgary-only billing address');
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect(page.locator('#customerBody')).toContainText(isolatedName);

    // Switch facility scope — the Calgary-only customer must not leak into
    // a request scoped to a different warehouse (server-enforced, per
    // CustomersService.findAll(actor, warehouseId)).
    await selectFacility(page, 'Ontario');
    await page.waitForSelector('#customerBody .table, #customerBody .empty');
    await expect(page.locator('#customerBody')).not.toContainText(isolatedName);

    await selectFacility(page, 'Calgary, AB');
    await page.waitForSelector('#customerBody .table, #customerBody .empty');
    await expect(page.locator('#customerBody')).toContainText(isolatedName);
  });

  test('staff role cannot access the Customers view at all', async ({ page }) => {
    await loginAs(page, 'staff@greenwave.local');
    // The nav item is present but hidden (role-gated) rather than removed.
    await expect(page.locator('.navitem[data-view="customers"]')).toBeHidden();
  });
});
