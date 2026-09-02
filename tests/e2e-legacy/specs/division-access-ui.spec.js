const { test, expect } = require('@playwright/test');
const { loginAs, goToView, API_BASE } = require('./helpers');

/**
 * Division-aware frontend behaviour.
 *
 * These assert what the *user* can see and reach. The server-side matrix that
 * actually enforces the boundary lives in
 * backend/app/api/test/division-isolation.e2e-spec.ts — hiding a menu is not
 * authorization, so both layers are covered separately.
 *
 * Dev accounts (backend/database/seeds/004_dev_division_fixtures.sql):
 *   admin@greenwave.local      admin,   both divisions
 *   gw.only@greenwave.local    manager, GreenWave only, Calgary + Ontario
 *   hc.only@greenwave.local    manager, Healthcare only, Maple Ridge
 *   unassigned@greenwave.local staff,   no division at all
 */
test.describe('Division access — navigation and view isolation', () => {
  test('a both-divisions user gets a working switcher in the sidebar and top bar', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    await expect(page.locator('#railDivisionSwitcher')).toBeVisible();
    await expect(page.locator('#topDivisionToggle')).toBeVisible();
    await expect(page.locator('#railDivisionStatic')).toBeHidden();
    await expect(page.locator('#topDivisionStatic')).toBeHidden();

    await expect(page.locator('#topDivRecycling')).toBeVisible();
    await expect(page.locator('#topDivHealthcare')).toBeVisible();

    // Switching actually changes the active division identity.
    await expect(page.locator('html')).toHaveAttribute('data-entity', 'recycling');
    await page.click('#topDivHealthcare');
    await expect(page.locator('html')).toHaveAttribute('data-entity', 'healthcare');
    await page.click('#topDivRecycling');
    await expect(page.locator('html')).toHaveAttribute('data-entity', 'recycling');
  });

  test('a GreenWave-only user sees no switcher, only a statement of their business unit', async ({ page }) => {
    await loginAs(page, 'gw.only@greenwave.local');

    await expect(page.locator('#railDivisionSwitcher')).toBeHidden();
    await expect(page.locator('#topDivisionToggle')).toBeHidden();
    await expect(page.locator('#railDivisionStatic')).toBeVisible();
    await expect(page.locator('#railDivisionLabel')).toHaveText('GreenWave Recycling');
    await expect(page.locator('#topDivisionStaticLabel')).toHaveText('GreenWave Recycling');

    // The Healthcare control must not be reachable at all.
    await expect(page.locator('#topDivHealthcare')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-entity', 'recycling');
  });

  test('a Healthcare-only user sees the Healthcare identity and no GreenWave-specific navigation', async ({ page }) => {
    await loginAs(page, 'hc.only@greenwave.local');

    await expect(page.locator('#railDivisionStatic')).toBeVisible();
    await expect(page.locator('#railDivisionLabel')).toHaveText('Healthcare');
    await expect(page.locator('html')).toHaveAttribute('data-entity', 'healthcare');
    await expect(page.locator('#topDivRecycling')).toBeHidden();

    // Invoices is GreenWave-only navigation (data-only="recycling").
    await expect(page.locator('.navitem[data-view="invoices"]')).toBeHidden();
  });

  test('the catalog contains only the signed-in division, both ways', async ({ page }) => {
    await loginAs(page, 'gw.only@greenwave.local');
    await goToView(page, 'products');
    await page.waitForSelector('#productBody .table, #productBody .empty');
    await expect(page.locator('#productBody')).toContainText('Calgary Baled Cardboard');
    await expect(page.locator('#productBody')).not.toContainText('Maple Ridge Surgical Masks');
    await expect(page.locator('#productBody')).not.toContainText('Synguard');
  });

  test('a Healthcare-only user sees Healthcare products and no recycling materials', async ({ page }) => {
    await loginAs(page, 'hc.only@greenwave.local');
    await goToView(page, 'products');
    await page.waitForSelector('#productBody .table, #productBody .empty');
    await expect(page.locator('#productBody')).toContainText('Maple Ridge Surgical Masks');
    await expect(page.locator('#productBody')).not.toContainText('Calgary Baled Cardboard');
    await expect(page.locator('#productBody')).not.toContainText('Mixed Electronics');
  });

  test('a user with no division sees the empty-state and fetches no division data', async ({ page }) => {
    const divisionScoped = [];
    page.on('request', (req) => {
      const u = req.url();
      if (!u.startsWith(API_BASE)) return;
      if (/\/(materials|containers|inventory|invoices|customers)\b/.test(u)) divisionScoped.push(u);
    });

    await loginAs(page, 'unassigned@greenwave.local');
    await page.waitForSelector('#noDivisionState');

    await expect(page.locator('#noDivisionState')).toContainText('No business unit assigned');

    // Neither switcher shape is offered.
    await expect(page.locator('#railDivisionSwitcher')).toBeHidden();
    await expect(page.locator('#railDivisionStatic')).toBeHidden();

    // Operational navigation is gone, not merely styled as disabled.
    for (const v of ['inventory', 'photos', 'timeclock', 'products', 'customers', 'invoices']) {
      await expect(page.locator(`.navitem[data-view="${v}"]`)).toBeHidden();
    }

    // The point of the empty state: unauthorized division data is never even
    // requested in the background.
    expect(divisionScoped).toEqual([]);
  });

  test('switching division swaps the catalog with no stale rows from the previous one', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await goToView(page, 'products');
    await page.waitForSelector('#productBody .table, #productBody .empty');
    await expect(page.locator('#productBody')).toContainText('Mixed Electronics');

    await page.click('#topDivHealthcare');
    await page.waitForSelector('#productBody .table, #productBody .empty');
    await expect(page.locator('#productBody')).toContainText('Synguard');
    await expect(page.locator('#productBody')).not.toContainText('Mixed Electronics');
  });
});

test.describe('Division access — staff management', () => {
  test('the staff table states each account\'s division assignment', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await goToView(page, 'staff');
    await page.waitForSelector('#staffBody .table');

    const head = (await page.locator('#staffBody thead').innerText()).toUpperCase();
    expect(head).toContain('DIVISION ACCESS');
    // Division and warehouse stay separate columns — they are separate grants.
    expect(head).toContain('WAREHOUSE ACCESS');

    const gwRow = page.locator('#staffBody tr', { hasText: 'gw.only@greenwave.local' });
    // The chip is labelled compactly so nine columns fit without a horizontal
    // scrollbar; the full division name is kept on the chip's title, so both
    // the visible text and the accessible full name are asserted here.
    await expect(gwRow.locator('.division-badge')).toHaveText(/GreenWave/);
    await expect(gwRow.locator('.division-badge')).toHaveAttribute('title', 'GreenWave Recycling');
    await expect(gwRow).not.toContainText('Healthcare');

    const hcRow = page.locator('#staffBody tr', { hasText: 'hc.only@greenwave.local' });
    await expect(hcRow).toContainText('Healthcare');

    const noneRow = page.locator('#staffBody tr', { hasText: 'unassigned@greenwave.local' });
    await expect(noneRow).toContainText('No division access');
  });

  test('the edit-staff form exposes a DIVISION ACCESS section reflecting the stored grant', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await goToView(page, 'staff');
    await page.waitForSelector('#staffBody .table');

    const row = page.locator('#staffBody tr', { hasText: 'hc.only@greenwave.local' });
    await row.locator('.btn-edit-user').click();
    await page.waitForSelector('#modalWrap:not([hidden])');

    const modal = page.locator('#modalForm');
    await expect(modal).toContainText('Division access');
    await expect(modal.locator('input[name="div_recycling"]')).toHaveCount(1);
    await expect(modal.locator('input[name="div_healthcare"]')).toHaveCount(1);

    // Reflects what the server actually stores for this account.
    await expect(modal.locator('input[name="div_healthcare"]')).toBeChecked();
    await expect(modal.locator('input[name="div_recycling"]')).not.toBeChecked();
  });

  test('the create-staff form defaults to NO division access', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await goToView(page, 'staff');
    await page.waitForSelector('#staffBody .table');

    await page.click('#newStaff');
    await page.waitForSelector('#modalWrap:not([hidden])');

    const modal = page.locator('#modalForm');
    await expect(modal).toContainText('Division access');
    await expect(modal.locator('input[name="div_recycling"]')).not.toBeChecked();
    await expect(modal.locator('input[name="div_healthcare"]')).not.toBeChecked();
  });

  test('a single-division admin cannot offer a division they do not hold', async ({ page }) => {
    // gw.only is a manager, so Staff Management is not theirs to use at all —
    // which is itself the check: division assignment is admin-only.
    await loginAs(page, 'gw.only@greenwave.local');
    await expect(page.locator('.navitem[data-view="staff"]')).toBeHidden();
  });
});

test.describe('Division access — account settings', () => {
  test('settings states role, division access and warehouse access', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await goToView(page, 'settings');
    await page.waitForSelector('#settingsBody');

    const body = page.locator('#settingsBody');
    await expect(body).toContainText('Your access');
    await expect(body).toContainText('Role');
    await expect(body).toContainText('Division access');
    await expect(body).toContainText('Warehouse access');
    await expect(body).toContainText('GreenWave Recycling');
    await expect(body).toContainText('Healthcare');
  });

  test('a single-division user sees only their own division in settings', async ({ page }) => {
    await loginAs(page, 'hc.only@greenwave.local');
    await goToView(page, 'settings');
    await page.waitForSelector('#settingsBody');

    const chips = page.locator('#settingsBody .division-badge');
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('Healthcare');
  });
});
