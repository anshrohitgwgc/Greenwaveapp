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
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900',  width: 1440, height: 900 },
  { name: '1280x800',  width: 1280, height: 800 },
  { name: '1024x768',  width: 1024, height: 768 },
  { name: '768x1024',  width: 768,  height: 1024 },
  { name: '390x844',   width: 390,  height: 844 },
];

/** The widths at which Staff Management renders as a table, not as cards. */
const DESKTOP_VIEWPORTS = VIEWPORTS.filter((v) => v.width > 768);

/**
 * Addresses long enough to have been ellipsised by the previous column
 * budget. Written into already-rendered cells so the assertion does not
 * depend on what the dev seed happens to contain.
 */
const LONG_EMAILS = [
  'operations.manager@greenwaverecycling.com',
  'warehouse.supervisor@greenwavehealthcare.com',
  'warehouse.operations.supervisor@greenwave-recycling-holdings.com',
];

/** Replaces every rendered email with a long one and returns what was set. */
async function useLongEmails(page) {
  return page.evaluate((emails) => {
    const cells = Array.from(document.querySelectorAll('#staffBody .staff-email'));
    cells.forEach((el, i) => {
      el.textContent = emails[i % emails.length];
      el.setAttribute('title', emails[i % emails.length]);
    });
    return cells.length;
  }, LONG_EMAILS);
}

/**
 * An element is showing its whole value only if it is not scrolling its own
 * content away in either axis. `textContent` alone proves nothing: an
 * ellipsised cell still holds the full string in the DOM.
 */
async function emailVisibility(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#staffBody .staff-email')).map((el) => {
      const cs = getComputedStyle(el);
      return {
        text: el.textContent,
        clippedX: el.scrollWidth - el.clientWidth,
        clippedY: el.scrollHeight - el.clientHeight,
        textOverflow: cs.textOverflow,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
      };
    }),
  );
}

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

  test('the full email is visible at every desktop width, never ellipsised', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    for (const vp of DESKTOP_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigate(page, 'staff');
      await page.waitForSelector('#staffBody .table', { timeout: 15000 });

      const count = await useLongEmails(page);
      expect(count, `no email cells rendered at ${vp.name}`).toBeGreaterThan(0);

      const cells = await emailVisibility(page);
      for (const cell of cells) {
        // The address must not be cut off horizontally...
        expect(
          cell.clippedX,
          `email "${cell.text}" is cut off horizontally at ${vp.name}`,
        ).toBeLessThanOrEqual(1);
        // ...nor vertically, which is how a wrapped value gets hidden instead.
        expect(
          cell.clippedY,
          `email "${cell.text}" is cut off vertically at ${vp.name}`,
        ).toBeLessThanOrEqual(1);
        // And it must not be *hidden* rather than fitted: an ellipsis or a
        // clipping overflow would conceal the problem instead of solving it.
        expect(
          cell.textOverflow,
          `email is ellipsised at ${vp.name}`,
        ).not.toBe('ellipsis');
        expect(
          [cell.overflowX, cell.overflowY],
          `email cell hides its overflow at ${vp.name}`,
        ).toEqual(['visible', 'visible']);
      }

      // Widening the email must not have been paid for by the page.
      await expectNoPageOverflow(page, vp.width, `staff long emails ${vp.name}`);
    }
  });

  test('no cell in the table truncates its own content at any desktop width', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    for (const vp of DESKTOP_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigate(page, 'staff');
      await page.waitForSelector('#staffBody .table', { timeout: 15000 });
      await useLongEmails(page);

      // Trading the email's truncation for another column's is not a fix, so
      // assert on every visible cell rather than just the one that changed.
      const truncated = await page.evaluate(() => {
        const out = [];
        document
          .querySelectorAll('#staffBody thead th, #staffBody tbody td')
          .forEach((cell) => {
            if (getComputedStyle(cell).display === 'none') return;
            for (const el of [cell, ...cell.querySelectorAll('*')]) {
              const cs = getComputedStyle(el);
              if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
              if (el.scrollWidth - el.clientWidth > 1) {
                out.push({
                  column: cell.getAttribute('data-label') || cell.textContent.trim(),
                  text: (el.textContent || '').trim().slice(0, 40),
                  by: el.scrollWidth - el.clientWidth,
                });
                break;
              }
            }
          });
        return out;
      });

      expect(
        truncated,
        `columns truncated at ${vp.name}: ${JSON.stringify(truncated)}`,
      ).toEqual([]);
    }
  });

  test('the mobile card still shows the whole email', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');

    for (const vp of VIEWPORTS.filter((v) => v.width <= 768)) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigate(page, 'staff');
      await page.waitForSelector('#staffBody .table', { timeout: 15000 });
      await useLongEmails(page);

      const cells = await emailVisibility(page);
      expect(cells.length, `no email cells at ${vp.name}`).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.clippedX, `mobile email clipped at ${vp.name}`).toBeLessThanOrEqual(1);
        expect(cell.clippedY, `mobile email clipped at ${vp.name}`).toBeLessThanOrEqual(1);
        expect(cell.textOverflow, `mobile email ellipsised at ${vp.name}`).not.toBe('ellipsis');
        expect(cell.text).toContain('@');
      }

      await expectNoPageOverflow(page, vp.width, `staff mobile ${vp.name}`);
    }
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
