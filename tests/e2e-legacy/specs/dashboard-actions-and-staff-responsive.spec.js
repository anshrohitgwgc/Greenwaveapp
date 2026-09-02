const { test, expect } = require('@playwright/test');
const { loginAs, goToView } = require('./helpers');

/**
 * Covers the two post-release UI changes:
 *
 *   - the Dashboard's new Add Inbound / Add Outbound header actions, which
 *     must open the *existing* inventory workflows rather than a second
 *     implementation of them;
 *   - the Staff Management table, which must stop producing a horizontal
 *     scrollbar without hiding any staff information or action.
 */

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844',  width: 390,  height: 844 },
];

/** Nothing may make the document wider than the viewport. */
async function expectNoPageOverflow(page, width, context) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `horizontal page overflow at ${context}`).toBeLessThanOrEqual(width + 2);
}

/** The narrow viewports keep the nav off-canvas behind the hamburger. */
async function navigate(page, view) {
  const menuBtn = page.locator('#menuBtn');
  if (await menuBtn.isVisible()) await menuBtn.click();
  await page.click(`.navitem[data-view="${view}"]`);
  await page.waitForSelector(`#v-${view}.view`, { state: 'visible' });
}

test.describe('Dashboard inbound/outbound actions', () => {
  test('both actions are visible and clickable at every supported viewport', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigate(page, 'dashboard');

      const inbound = page.locator('#dashBtnAddInbound');
      const outbound = page.locator('#dashBtnAddOutbound');

      await expect(inbound, `Add Inbound missing at ${vp.name}`).toBeVisible();
      await expect(outbound, `Add Outbound missing at ${vp.name}`).toBeVisible();
      await expect(inbound).toHaveText(/Add Inbound/);
      await expect(outbound).toHaveText(/Add Outbound/);

      // A control that is visible but too small or clipped is not usable.
      for (const [label, btn] of [['inbound', inbound], ['outbound', outbound]]) {
        const box = await btn.boundingBox();
        expect(box, `${label} has no box at ${vp.name}`).not.toBeNull();
        expect(box.height, `${label} too short at ${vp.name}`).toBeGreaterThanOrEqual(36);
        expect(box.width, `${label} too narrow at ${vp.name}`).toBeGreaterThanOrEqual(90);
        expect(box.x, `${label} starts off-screen at ${vp.name}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label} overflows at ${vp.name}`).toBeLessThanOrEqual(vp.width + 2);
      }

      await expectNoPageOverflow(page, vp.width, `dashboard ${vp.name}`);
    }
  });

  test('the actions sit in the dashboard header, to the right of the title', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin@greenwave.local');
    await navigate(page, 'dashboard');

    const header = page.locator('#v-dashboard .vhead');
    await expect(header.locator('#dashBtnAddInbound')).toHaveCount(1);
    await expect(header.locator('#dashBtnAddOutbound')).toHaveCount(1);

    const title = await page.locator('#v-dashboard .vhead h1').boundingBox();
    const inbound = await page.locator('#dashBtnAddInbound').boundingBox();
    expect(inbound.x, 'actions must sit to the right of the title')
      .toBeGreaterThan(title.x + title.width);
  });

  test('Add Inbound opens the existing inbound workflow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin@greenwave.local');
    await navigate(page, 'dashboard');

    await page.click('#dashBtnAddInbound');
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    // Same modal the Inventory view opens — not a parallel implementation.
    await expect(modal.locator('.modalhead')).toContainText(/Receive Inbound/i);
  });

  test('Add Outbound opens the existing outbound workflow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin@greenwave.local');
    await navigate(page, 'dashboard');

    await page.click('#dashBtnAddOutbound');
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modalhead')).toContainText(/Ship Outbound/i);
  });

  test('the dashboard action opens the same modal as the Inventory view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin@greenwave.local');

    await navigate(page, 'inventory');
    await page.click('#btnReceiveStock');
    await expect(page.locator('.modal')).toBeVisible();
    const fromInventory = await page.locator('.modal .modalhead').innerText();
    await page.keyboard.press('Escape');

    await navigate(page, 'dashboard');
    await page.click('#dashBtnAddInbound');
    await expect(page.locator('.modal')).toBeVisible();
    const fromDashboard = await page.locator('.modal .modalhead').innerText();

    expect(fromDashboard).toBe(fromInventory);
  });
});

test.describe('Staff Management table responsiveness', () => {
  test('no horizontal scrollbar and no page overflow at any viewport', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigate(page, 'staff');
      await page.waitForSelector('#staffBody .table', { timeout: 15000 });

      await expectNoPageOverflow(page, vp.width, `staff ${vp.name}`);

      // The table wrapper itself must not scroll horizontally either — that
      // is the scrollbar under the table this change removes.
      const wrap = await page.evaluate(() => {
        const el = document.querySelector('#staffBody .tablewrap');
        if (!el) return null;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      expect(wrap, `no table wrapper at ${vp.name}`).not.toBeNull();
      expect(
        wrap.scrollWidth,
        `staff table scrolls horizontally at ${vp.name} (${wrap.scrollWidth} > ${wrap.clientWidth})`,
      ).toBeLessThanOrEqual(wrap.clientWidth + 2);

      // The body must not scroll sideways either.
      const bodyOverflow = await page.evaluate(
        () => document.body.scrollWidth - document.body.clientWidth,
      );
      expect(bodyOverflow, `body overflows at ${vp.name}`).toBeLessThanOrEqual(2);
    }
  });

  test('View and Edit stay visible and inside the viewport at every width', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigate(page, 'staff');
      await page.waitForSelector('#staffBody .table', { timeout: 15000 });

      const view = page.locator('.btn-view-user').first();
      const edit = page.locator('.btn-edit-user').first();
      await expect(view, `View hidden at ${vp.name}`).toBeVisible();
      await expect(edit, `Edit hidden at ${vp.name}`).toBeVisible();

      for (const [label, btn] of [['View', view], ['Edit', edit]]) {
        const box = await btn.boundingBox();
        expect(box, `${label} has no box at ${vp.name}`).not.toBeNull();
        expect(box.x, `${label} clipped off the left at ${vp.name}`).toBeGreaterThanOrEqual(0);
        expect(
          box.x + box.width,
          `${label} clipped off the right at ${vp.name}`,
        ).toBeLessThanOrEqual(vp.width + 2);
      }
    }
  });

  test('a very long email never widens the page', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigate(page, 'staff');
    await page.waitForSelector('#staffBody .table', { timeout: 15000 });

    // Force a pathological value into a rendered cell and re-measure.
    await page.evaluate(() => {
      const cell = document.querySelector('#staffBody .staff-email');
      if (cell) {
        cell.textContent =
          'an.extremely.long.operations.department.address.for.testing@a-very-long-corporate-subdomain.greenwaverecycling.example.com';
      }
    });

    await expectNoPageOverflow(page, 1280, 'staff with long email');
    const wrap = await page.evaluate(() => {
      const el = document.querySelector('#staffBody .tablewrap');
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(
      wrap.scrollWidth,
      'a long email must not make the staff table scroll',
    ).toBeLessThanOrEqual(wrap.clientWidth + 2);
  });

  test('every staff row keeps its data reachable at mobile width', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate(page, 'staff');
    await page.waitForSelector('#staffBody .table', { timeout: 15000 });

    // At 390px the table becomes labelled cards; nothing may be display:none,
    // which is the "clipped content with no usable alternative" failure mode.
    const hidden = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('#staffBody tbody tr:first-child td'));
      return cells
        .filter((td) => getComputedStyle(td).display === 'none')
        .map((td) => td.getAttribute('data-label') || '(unlabelled)');
    });
    expect(hidden, `columns hidden with no alternative at 390px: ${hidden.join(', ')}`).toEqual([]);

    // And each card cell must carry its column name.
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#staffBody tbody tr:first-child td'))
        .map((td) => td.getAttribute('data-label')),
    );
    expect(labels).toContain('Email');
    expect(labels).toContain('Role');
    expect(labels).toContain('Actions');
  });
});
