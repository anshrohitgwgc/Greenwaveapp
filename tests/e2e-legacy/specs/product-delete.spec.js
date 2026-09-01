const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

// Exercises the admin-only Delete Product flow end-to-end against a product
// created specifically for this test, so the 9 seeded production catalog
// items are never touched.
test.describe('Product Delete', () => {
  test('admin can create a disposable product, delete it via the confirmation modal, and see it disappear', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#productBody .table, #productBody .empty');

    const productName = 'E2E Disposable Widget ' + Date.now();

    await page.click('#newProduct');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await page.fill('#modalForm input[name="name"]', productName);
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    const row = page.locator('#productBody tr', { hasText: productName });
    await expect(row).toBeVisible();

    // The Delete Product action is visually destructive and separate from Edit.
    const deleteBtn = row.locator('[data-delete-material]');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toHaveText('Delete Product');
    await expect(row.locator('[data-edit-material]')).toBeVisible();

    await deleteBtn.click();
    await page.waitForSelector('#modalWrap:not([hidden])');

    // Confirmation modal shows product/warehouse/division and a clear warning.
    await expect(page.locator('#modalTitle')).toHaveText('Delete Product?');
    const modalBody = page.locator('#modalForm');
    await expect(modalBody).toContainText(productName);
    await expect(modalBody).toContainText('permanently removes the product from the catalog');
    await expect(page.locator('#modalOk')).toHaveText('Delete Product');
    await expect(page.locator('#modalOk')).toHaveClass(/danger/);
    await expect(page.locator('#modalCancel')).toHaveText('Cancel');

    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect(page.locator('#toast')).toContainText('Product deleted successfully');
    await expect(page.locator('#productBody')).not.toContainText(productName);
  });

  test('cancelling the delete confirmation leaves the product in the catalog', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#productBody .table, #productBody .empty');

    const productName = 'E2E Cancel-Delete Widget ' + Date.now();

    await page.click('#newProduct');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await page.fill('#modalForm input[name="name"]', productName);
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    const row = page.locator('#productBody tr', { hasText: productName });
    await row.locator('[data-delete-material]').click();
    await page.waitForSelector('#modalWrap:not([hidden])');

    await page.click('#modalCancel');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect(page.locator('#productBody')).toContainText(productName);

    // Clean up the product this test created so it doesn't linger.
    await row.locator('[data-delete-material]').click();
    await page.waitForSelector('#modalWrap:not([hidden])');
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });
  });

  test('Delete Product action is not available to staff (Products nav is admin/manager-only)', async ({ page }) => {
    await loginAs(page, 'staff@greenwave.local');
    await expect(page.locator('.navitem[data-view="products"]')).toBeHidden();
  });

  test('Delete Product action is not available to driver (Products nav is admin/manager-only)', async ({ page }) => {
    await loginAs(page, 'driver@greenwave.local');
    await expect(page.locator('.navitem[data-view="products"]')).toBeHidden();
  });

  test('Delete Product action is not available to an ordinary manager (delete is admin-only)', async ({ page }) => {
    await loginAs(page, 'manager@greenwave.local');
    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#productBody .table, #productBody .empty');

    await expect(page.locator('[data-delete-material]')).toHaveCount(0);
    // Manager can still Edit — only Delete is restricted to admin.
    await expect(page.locator('[data-edit-material]').first()).toBeVisible();
  });
});
