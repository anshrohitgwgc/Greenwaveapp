const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

test.describe('Materials Catalog — SKU removal + division isolation', () => {
  test('catalog has no SKU column and switching divisions swaps the product list with no stale carryover', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#v-products.view.active');
    await page.waitForSelector('#productBody .table, #productBody .empty');

    // No SKU / Code anywhere in the catalog UI.
    await expect(page.locator('#v-products')).not.toContainText('SKU');
    await expect(page.locator('#v-products')).not.toContainText('Stock Keeping Unit');

    // Default division is Recycling — expect recycling materials, not healthcare ones.
    await expect(page.locator('#productBody')).toContainText('Mixed Electronics');
    await expect(page.locator('#productBody')).not.toContainText('Synguard');

    // Switch to Healthcare — the recycling product must disappear entirely
    // (not just be hidden), and the healthcare catalog must appear.
    await page.click('#topDivHealthcare');
    await page.waitForSelector('#productBody .table, #productBody .empty');
    await expect(page.locator('#productBody')).toContainText('Synguard');
    await expect(page.locator('#productBody')).not.toContainText('Mixed Electronics');

    // Switch back — no stale Healthcare product should linger.
    await page.click('#topDivRecycling');
    await page.waitForSelector('#productBody .table, #productBody .empty');
    await expect(page.locator('#productBody')).toContainText('Mixed Electronics');
    await expect(page.locator('#productBody')).not.toContainText('Synguard');
  });

  test('catalog table shows Division and Status columns, not SKU or price', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#productBody .table, #productBody .empty');

    const headerText = (await page.locator('#productBody thead').innerText().catch(() => '')).toUpperCase();
    if (headerText) {
      expect(headerText).toContain('DIVISION');
      expect(headerText).toContain('STATUS');
      expect(headerText).not.toContain('SKU');
      expect(headerText).not.toContain('UNIT PRICE');
    }
  });

  test('Add Product modal shows Facility + Division, never asks for a SKU', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#productBody .table, #productBody .empty');

    await page.click('#newProduct');
    await page.waitForSelector('#modalWrap:not([hidden])');

    const modal = page.locator('#modalForm');
    await expect(modal.locator('input[name="name"]')).toHaveCount(1);
    await expect(modal.locator('input[name="facilityDisplay"]')).toHaveCount(1);
    await expect(modal.locator('select[name="division"]')).toHaveCount(1);
    await expect(modal.locator('input[name="sku"]')).toHaveCount(0);
    await expect(page.locator('#modalWrap')).not.toContainText('SKU');
  });
});
