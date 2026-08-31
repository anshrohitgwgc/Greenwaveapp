const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

test.describe('History — operational transaction timeline replaces the old Inventory ledger tab', () => {
  test('Inventory no longer exposes a Transactions Ledger tab', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');

    await expect(page.locator('#v-inventory')).not.toContainText('Transactions Ledger');
    await expect(page.locator('#v-inventory')).not.toContainText('PostgreSQL ledger');
    await expect(page.locator('.inven-tab[data-tab="transactions"]')).toHaveCount(0);
  });

  test('History shows the transaction timeline by default, with row click-through to full details', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="history"]');
    await page.waitForSelector('#v-history.view.active');
    await page.waitForSelector('#historyBody .table, #historyBody .empty', { timeout: 15000 });

    const row = page.locator('#historyBody .clickable-row[data-tx]').first();
    const rowCount = await row.count();
    test.skip(rowCount === 0, 'No inventory transactions in this local fixture set to open.');

    await row.click();
    await page.waitForSelector('#modalWrap:not([hidden])');
    await expect(page.locator('#modalTitle')).toContainText('Transaction Details');
    await expect(page.locator('#modalForm')).toContainText('Recorded At');
    await expect(page.locator('#modalForm')).toContainText('Facility / Warehouse');
    await expect(page.locator('#modalForm')).toContainText('Associated Photos');
  });
});
