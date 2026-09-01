const { test, expect } = require('@playwright/test');
const { loginAs, API_BASE } = require('./helpers');

/**
 * Regression coverage for the centered empty-state "Add customer" / "Add
 * material" buttons.
 *
 * These buttons render `data-action="newCustomer"` / `data-action="newProduct"`
 * -- names that matched the top-right toolbar button *element ids* but were
 * never registered in the delegated document click handler, so clicking them
 * did nothing at all. Both entry points now dispatch through one shared
 * action registry, so this suite asserts that each pair opens the *same*
 * modal.
 *
 * The empty states are produced by stubbing the list endpoint to return `[]`,
 * so these tests never depend on (or mutate) real catalog/customer data.
 */

async function stubEmpty(page, pathRe) {
  await page.route((url) => pathRe.test(url.pathname), (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });
}

test.describe('Empty-state create buttons', () => {
  test('centered "Add customer" opens the same modal as the top-right button', async ({ page }) => {
    // Install the stub before loginAs() navigates, otherwise a real
    // (non-empty) response can win the race and the empty state never renders.
    await stubEmpty(page, /^\/customers$/);
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.navitem[data-view="customers"]');
    await page.waitForSelector('#v-customers.view.active');
    await page.waitForSelector('#customerBody .empty');

    // The empty state must actually offer the button.
    const centerBtn = page.locator('#customerBody .empty button[data-action="newCustomer"]');
    await expect(centerBtn).toBeVisible();

    // Centered button opens the modal.
    await centerBtn.click();
    await page.waitForSelector('#modalWrap:not([hidden])');
    const centerTitle = await page.locator('#modalTitle').textContent();
    const centerFields = await page.locator('#modalForm [name]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('name')).join(','),
    );
    expect(centerTitle).toContain('Add Customer');

    await page.click('#modalCancel');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    // Top-right button opens an identical modal (same title, same fields) --
    // proving there is a single form implementation behind both.
    await page.click('#newCustomer');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const topTitle = await page.locator('#modalTitle').textContent();
    const topFields = await page.locator('#modalForm [name]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('name')).join(','),
    );

    expect(topTitle).toBe(centerTitle);
    expect(topFields).toBe(centerFields);
  });

  test('centered "Add material" opens the same modal as the top-right button (Recycling)', async ({ page }) => {
    // Install the stub before loginAs() navigates, otherwise a real
    // (non-empty) response can win the race and the empty state never renders.
    await stubEmpty(page, /^\/materials$/);
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#v-products.view.active');
    await page.waitForSelector('#productBody .empty');

    const centerBtn = page.locator('#productBody .empty button[data-action="newProduct"]');
    await expect(centerBtn).toBeVisible();

    await centerBtn.click();
    await page.waitForSelector('#modalWrap:not([hidden])');
    const centerTitle = await page.locator('#modalTitle').textContent();
    const centerFields = await page.locator('#modalForm [name]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('name')).join(','),
    );
    // Division must always be part of the form -- the API rejects a missing one.
    expect(centerFields).toContain('division');

    await page.click('#modalCancel');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await page.click('#newProduct');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const topTitle = await page.locator('#modalTitle').textContent();
    const topFields = await page.locator('#modalForm [name]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('name')).join(','),
    );

    expect(topTitle).toBe(centerTitle);
    expect(topFields).toBe(centerFields);
  });

  test('centered "Add material" in Healthcare defaults the new product to division=healthcare', async ({ page }) => {
    // Install the stub before loginAs() navigates, otherwise a real
    // (non-empty) response can win the race and the empty state never renders.
    await stubEmpty(page, /^\/materials$/);
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.entsw button[data-entity="healthcare"]');
    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#v-products.view.active');
    await page.waitForSelector('#productBody .empty');

    await page.locator('#productBody .empty button[data-action="newProduct"]').click();
    await page.waitForSelector('#modalWrap:not([hidden])');

    await expect(page.locator('#modalTitle')).toContainText('Add Product');
    await expect(page.locator('#modalForm [name="division"]')).toHaveValue('healthcare');
  });

  test('centered "Add material" in Recycling defaults the new material to division=recycling', async ({ page }) => {
    // Install the stub before loginAs() navigates, otherwise a real
    // (non-empty) response can win the race and the empty state never renders.
    await stubEmpty(page, /^\/materials$/);
    await loginAs(page, 'admin@greenwave.local');

    await page.click('.entsw button[data-entity="recycling"]');
    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#v-products.view.active');
    await page.waitForSelector('#productBody .empty');

    await page.locator('#productBody .empty button[data-action="newProduct"]').click();
    await page.waitForSelector('#modalWrap:not([hidden])');

    await expect(page.locator('#modalTitle')).toContainText('Add Material');
    await expect(page.locator('#modalForm [name="division"]')).toHaveValue('recycling');
  });

  test('the division the UI submits matches the division being viewed', async ({ page }) => {
    // Install the stub before loginAs() navigates, otherwise a real
    // (non-empty) response can win the race and the empty state never renders.
    await stubEmpty(page, /^\/materials$/);
    await loginAs(page, 'admin@greenwave.local');

    // Capture the POST body the frontend actually sends.
    let posted = null;
    await page.route((url) => /^\/materials$/.test(url.pathname), (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      posted = JSON.parse(req.postData() || '{}');
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'stub', name: posted.name, division: posted.division }),
      });
    });

    await page.click('.entsw button[data-entity="healthcare"]');
    await page.click('.navitem[data-view="products"]');
    await page.waitForSelector('#productBody .empty');
    await page.locator('#productBody .empty button[data-action="newProduct"]').click();
    await page.waitForSelector('#modalWrap:not([hidden])');

    await page.locator('#modalForm [name="name"]').fill('E2E Healthcare Stub Product');
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    expect(posted).not.toBeNull();
    expect(posted.division).toBe('healthcare');
    // The frontend must never omit division -- the backend rejects that.
    expect(Object.keys(posted)).toContain('division');
  });
});
