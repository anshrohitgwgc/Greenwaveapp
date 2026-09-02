const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

/**
 * Invoice numbering + print/PDF coverage.
 *
 * Numbering is allocated by a PostgreSQL sequence (migration 016) that starts
 * at 10000. The editor must never show a hardcoded stand-in -- it previously
 * rendered the literal string "1115 (Assigned)", which reads as a real
 * invoice number.
 */

async function openNewInvoiceEditor(page) {
  await page.click('.navitem[data-view="invoices"]');
  await page.waitForSelector('#v-invoices.view.active');
  await page.click('#newInvoice');
  await page.waitForSelector('#v-editor.view', { state: 'visible' });
  await page.waitForSelector('#edInvoiceNo');
}

async function fillAndSaveInvoice(page, description) {
  await page.click('#edAddLine');
  await page.locator('.ed-desc').first().fill(description);
  await page.locator('.ed-qty').first().fill('2');
  await page.locator('.ed-price').first().fill('50.00');
  await page.locator('#edPayInst').fill('Payable by EFT to Greenwave Recycling Inc.');
  await page.click('#edSave');
  await page.waitForSelector('#v-invoices.view.active', { timeout: 20000 });
  await page.waitForSelector('.btn-view-inv', { timeout: 20000 });
  // Newest invoice sorts first (descending numeric on invoice number).
  const first = await page.locator('[data-invoice-row] td.mono strong').first().textContent();
  return first.replace('#', '').trim();
}

test.describe('Invoice numbering', () => {
  test('the editor never shows the old hardcoded 1115 placeholder', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await openNewInvoiceEditor(page);

    const shown = (await page.locator('#edInvoiceNo').textContent()).trim();
    expect(shown).not.toContain('1115');

    // Whole editor must be free of it too.
    const editorText = await page.locator('#editorBody').innerText();
    expect(editorText).not.toContain('1115 (Assigned)');

    // The hint is server-provided: either a real number + (Assigned), or a
    // purely descriptive label when the backend could not be reached.
    expect(shown === 'Assigned on save' || /^\d+ \(Assigned\)$/.test(shown)).toBeTruthy();
  });

  test('the "(Assigned)" hint comes from the backend, not the browser', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    // Force a known preview value and assert the UI renders exactly it.
    await page.route((url) => /^\/invoices\/next-number$/.test(url.pathname), (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nextNumber: '424242', preview: true }),
      }));

    await openNewInvoiceEditor(page);
    await expect(page.locator('#edInvoiceNo')).toHaveText('424242 (Assigned)');
  });

  test('new invoices are numbered from the 10000 series and increment', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    await openNewInvoiceEditor(page);
    const first = await fillAndSaveInvoice(page, 'E2E numbering invoice A');

    await openNewInvoiceEditor(page);
    const second = await fillAndSaveInvoice(page, 'E2E numbering invoice B');

    expect(Number(first)).toBeGreaterThanOrEqual(10000);
    expect(Number(second)).toBeGreaterThanOrEqual(10000);
    // Strictly increasing, and never reissued.
    expect(Number(second)).toBeGreaterThan(Number(first));
  });

  test('concurrent invoice creation never issues a duplicate number', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="invoices"]');
    await page.waitForSelector('#v-invoices.view.active');

    // Fire a burst straight at the API from the authenticated page context.
    const numbers = await page.evaluate(async () => {
      const body = {
        invoiceDate: new Date().toISOString().slice(0, 10),
        billTo: 'E2E concurrency',
        // This admin holds both divisions, so the API requires the invoice's
        // division to be stated rather than guessed. Numbering itself is
        // division-agnostic — one global sequence — which is what the
        // assertions below check.
        division: 'greenwave',
        items: [{ description: 'concurrent', quantity: 1, unitPrice: 1 }],
      };
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          window.GreenwaveApi.createInvoice(body).then((r) => r.invoiceNumber)),
      );
      return results;
    });

    expect(numbers).toHaveLength(15);
    expect(new Set(numbers).size).toBe(15);
    numbers.forEach((n) => expect(Number(n)).toBeGreaterThanOrEqual(10000));
  });
});

test.describe('Invoice print / Save as PDF', () => {
  test('printing uses a deterministic Invoice-<number> filename and restores the tab title', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="invoices"]');
    await page.waitForSelector('#v-invoices.view.active');
    await page.waitForSelector('.btn-view-inv');

    const number = (await page.locator('[data-invoice-row] td.mono strong').first().textContent())
      .replace('#', '').trim();

    await page.locator('.btn-view-inv').first().click();
    await page.waitForSelector('#v-editor.view', { state: 'visible' });
    await expect(page.locator('#edTitle')).toContainText('Invoice #' + number);

    // The browser takes the "Save as PDF" filename from document.title at the
    // moment the print dialog opens, so assert the title at exactly that point.
    const result = await page.evaluate(() => {
      const original = window.print;
      let titleAtPrint = null;
      window.print = function () { titleAtPrint = document.title; };
      document.getElementById('edPrint').click();
      window.print = original;
      window.dispatchEvent(new Event('afterprint'));
      return { titleAtPrint, titleAfter: document.title };
    });

    expect(result.titleAtPrint).toBe('Invoice-' + number);
    expect(result.titleAtPrint + '.pdf').toBe('Invoice-' + number + '.pdf');
    // The app title must be put back once printing finishes.
    expect(result.titleAfter).not.toBe('Invoice-' + number);
  });

  test('the printed document shows the invoice number and leaks no SKU, IDs, or app chrome', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="invoices"]');
    await page.waitForSelector('.btn-view-inv');

    const number = (await page.locator('[data-invoice-row] td.mono strong').first().textContent())
      .replace('#', '').trim();

    await page.locator('.btn-view-inv').first().click();
    await page.waitForSelector('#v-editor.view', { state: 'visible' });
    await page.emulateMedia({ media: 'print' });

    const doc = page.locator('.invoice-page-1114');
    await expect(doc).toBeVisible();
    await expect(doc).toContainText(number);
    // Rendered uppercase by CSS; the DOM text keeps its authored casing.
    await expect(doc).toContainText(/payment instructions/i);

    const text = await doc.innerText();
    expect(text).not.toMatch(/\bSKU\b/i);
    // No internal UUIDs on a customer-facing document.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // No payment provider secrets.
    expect(text).not.toMatch(/sk_(live|test)_|whsec_/);

    // Application chrome must be hidden in print media.
    await expect(page.locator('.rail')).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('#v-editor .vhead')).toBeHidden();
  });
});
