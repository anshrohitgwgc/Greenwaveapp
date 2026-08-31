const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

test.describe('Invoice — saved document is read-only, not the edit form', () => {
  test('a saved invoice opened via View has no textareas/inputs and shows totals', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.navitem[data-view="invoices"]');
    await page.waitForSelector('#v-invoices.view.active');
    await page.waitForSelector('#invoiceList .table, #invoiceList .empty', { timeout: 15000 }).catch(() => {});

    const viewBtn = page.locator('.btn-view-inv').first();
    const hasInvoice = await viewBtn.count();
    test.skip(hasInvoice === 0, 'No saved invoices in this local fixture set to open.');

    await viewBtn.click();
    await page.waitForSelector('#v-editor.view.active');
    await page.waitForSelector('#editorBody .invoice-doc-readonly');

    const doc = page.locator('#editorBody .invoice-doc-readonly');
    await expect(doc.locator('textarea')).toHaveCount(0);
    await expect(doc.locator('input')).toHaveCount(0);
    await expect(doc.locator('button')).toHaveCount(0);

    await expect(doc).toContainText('TOTAL');
    await expect(doc).toContainText('Subtotal');
    await expect(doc).not.toContainText('SKU');

    // Edit mode is a *separate* explicit action, not the default "View" render.
    const editBtn = page.locator('#edSave');
    await expect(editBtn).toContainText('Edit Invoice');

    // Print output must show only the document — no app chrome/nav/buttons.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.vhead').first()).toBeHidden();
    await expect(doc).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
  });
});
