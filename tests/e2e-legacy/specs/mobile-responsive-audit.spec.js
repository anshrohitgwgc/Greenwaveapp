const { test, expect } = require('@playwright/test');
const path = require('path');

const SHOTS = process.env.SHOT_DIR;

const WAREHOUSE = { id: '11111111-1111-4111-8111-111111111111', name: 'Maple Ridge', code: 'MR-BC', province: 'BC', division: 'greenwave' };
const MATERIAL  = { id: '22222222-2222-4222-8222-222222222222', name: 'OCC Cardboard', category: 'paper', unit: 'kg', division: 'greenwave' };
const CUSTOMER  = { id: '44444444-4444-4444-8444-444444444444', name: 'Pacific Fibre Exports Ltd.', email: 'ap@pacificfibre.example', phone: '604-555-0133', address: '1200 Industrial Way, Delta BC', division: 'greenwave' };

const tx = (i) => ({
  id: `tx-${i}`, warehouseId: WAREHOUSE.id, warehouseName: 'Maple Ridge', materialId: MATERIAL.id,
  materialName: 'OCC Cardboard', type: i % 2 ? 'inbound' : 'outbound', division: 'recycling', unitType: 'pallet',
  xl: 4, l: 0, m: 0, s: 0, total: 4, weightValue: 3658, weightUnit: 'kg',
  orderNumber: `Jul20-DIVESTPC-AB38${i}`, reference: `Jul20-DIVESTPC-AB38${i}`,
  containerNumber: `MSMU 689693${i}`, sealNumber: `033669${i}`, notes: 'SI SENT, cross dock',
  createdBy: 1, creatorName: 'Admin User', createdAt: '2026-09-15T18:20:00.000Z', photos: [],
});

const invoice = (i) => ({
  id: `inv-${i}`, invoiceNumber: 10000 + i, customerId: CUSTOMER.id, customerName: CUSTOMER.name,
  status: ['draft','sent','paid','overdue'][i % 4], issueDate: '2026-09-01', dueDate: '2026-09-30',
  subtotalMinor: 1250000, taxMinor: 62500, totalMinor: 1312500, amountPaidMinor: 0, balanceMinor: 1312500,
  currency: 'CAD', division: 'greenwave', lineItems: [],
});

const po = (i) => ({
  id: `po-${i}`, poNumber: `PO-2026-${1000 + i}`, vendorName: 'Western Equipment Supply',
  status: ['draft','issued','received'][i % 3], issueDate: '2026-09-05', expectedDate: '2026-09-25',
  subtotalMinor: 450000, taxMinor: 22500, totalMinor: 472500, currency: 'CAD', items: [],
});

const payment = (i) => ({
  id: `pay-${i}`, invoiceId: `inv-${i}`, invoiceNumber: 10000 + i, customerName: CUSTOMER.name,
  amountMinor: 1312500, currency: 'CAD', method: ['card','bank_transfer','cheque'][i % 3],
  status: ['succeeded','pending','failed'][i % 3], createdAt: '2026-09-10T10:00:00.000Z', reference: `ch_3Q${i}abcd`,
});

async function stubApi(page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, '');
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

    if (p === '/auth/me') return json({ id: 1, email: 'admin@greenwave.test', fullName: 'Admin User', role: 'admin', permissions: ['warehouses:global_access'], hasGlobalAccess: true, divisions: [{ key: 'greenwave' }, { key: 'healthcare' }] });
    if (p === '/warehouses') return json([WAREHOUSE]);
    if (p === '/divisions' || p === '/divisions/catalog') return json([{ id: 'greenwave', key: 'greenwave', name: 'Recycling' }, { id: 'healthcare', key: 'healthcare', name: 'Healthcare' }]);
    if (p === '/materials') return json([MATERIAL]);
    if (p === '/customers') return json([CUSTOMER]);
    if (p === '/users') return json([{ id: 1, fullName: 'Admin User', email: 'admin@greenwave.test', role: 'admin', status: 'active', warehouseIds: [WAREHOUSE.id] }]);
    if (p === '/inventory/transactions') return json(Array.from({ length: 12 }, (_, i) => tx(i + 1)));
    if (p === '/inventory/balances') return json([{ warehouseId: WAREHOUSE.id, materialId: MATERIAL.id, division: 'recycling', balance: '480', xlBalance: '480', lBalance: '0', mBalance: '0', sBalance: '0', inboundTotal: '600', outboundTotal: '120', adjustmentTotal: '0' }]);
    if (p === '/containers') return json([]);
    if (p === '/invoices') return json(Array.from({ length: 10 }, (_, i) => invoice(i + 1)));
    if (p === '/invoices/next-number') return json({ invoiceNumber: 10011 });
    if (p === '/purchase-orders') return json(Array.from({ length: 8 }, (_, i) => po(i + 1)));
    if (p === '/purchase-orders/next-number') return json({ poNumber: 'PO-2026-1009' });
    if (p === '/payments') return json(Array.from({ length: 10 }, (_, i) => payment(i + 1)));
    if (p === '/payments/summary' || p === '/payments/metrics') return json({ totalMinor: 13125000, paidMinor: 4200000, outstandingMinor: 8925000, count: 10 });
    if (p === '/payments/stripe/overview') return json({ connected: false });
    if (p === '/photos') return json([]);
    // The real endpoint returns null when there is no open shift.
    if (p === '/timesheets/me/current') return json(null);
    if (p.startsWith('/timesheets')) return json([]);
    if (p.startsWith('/employees')) return json([]);
    if (p.startsWith('/accounting') || p.startsWith('/banking') || p.startsWith('/payables')) return json([]);
    if (p === '/chat/messages' || p === '/chat/online') return json([]);
    if (p === '/audit') return json([]);
    return json([]);
  });
}

const VIEWS = ['dashboard', 'inventory', 'history', 'products', 'customers', 'invoices', 'purchaseorders', 'payments', 'photos', 'staff'];

const SIZES = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '414x896', width: 414, height: 896 },
  { name: '430x932', width: 430, height: 932 },
  { name: '1440x900', width: 1440, height: 900 },
];

for (const size of SIZES) {
  test(`no horizontal overflow @ ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await stubApi(page);
    await page.addInitScript(() => window.sessionStorage.setItem('greenwave.session.token', 't'));
    await page.goto('/');
    await page.waitForSelector('#nav', { timeout: 15000 });

    const offenders = [];
    for (const view of VIEWS) {
      await page.evaluate((v) => {
        const btn = document.querySelector('.navitem[data-view="' + v + '"]');
        if (btn) btn.click();
      }, view);
      await page.waitForTimeout(450);

      /* Measured by walking the layout rather than reading
         documentElement.scrollWidth: the stylesheet sets
         `body { overflow-x: hidden }` on phones as a backstop, which clips the
         document and would make a scrollWidth assertion pass even when content
         genuinely overflows. An element wider than the viewport is only
         acceptable when an ancestor scrolls it horizontally on purpose
         (`.tablewrap`), so that is the exemption applied here. */
      const result = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const wide = [];
        document.querySelectorAll('#scroll *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width <= vw + 1 || r.height === 0) return;
          let p = el.parentElement, contained = false;
          while (p && p !== document.body) {
            const ps = getComputedStyle(p);
            if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { contained = true; break; }
            p = p.parentElement;
          }
          if (!contained) {
            wide.push(el.tagName.toLowerCase() + '.' +
              (el.className || '').toString().split(' ')[0] + ' w=' + Math.round(r.width));
          }
        });
        return { vw, wide: wide.slice(0, 6) };
      });

      if (result.wide.length) {
        offenders.push(`${view} (vw=${result.vw}): ${JSON.stringify(result.wide)}`);
      }

      if (process.env.SHOT_DIR && (size.name === '390x844' || size.name === '1440x900')) {
        await page.screenshot({ path: path.join(process.env.SHOT_DIR, `${size.name}-${view}.png`), fullPage: false });
      }
    }

    expect(offenders, `Horizontal overflow at ${size.name}:\n` + offenders.join('\n')).toEqual([]);
  });
}

test('stacked tables replace side-scrolling on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubApi(page);
  await page.addInitScript(() => window.sessionStorage.setItem('greenwave.session.token', 't'));
  await page.goto('/');
  await page.waitForSelector('#nav', { timeout: 15000 });

  await page.evaluate(() => document.querySelector('.navitem[data-view="history"]').click());
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const t = document.querySelector('#v-history table.table');
    if (!t) return { found: false };
    const firstCell = t.querySelector('tbody td');
    return {
      found: true,
      stacked: t.classList.contains('stack-mobile'),
      labelled: !!(firstCell && firstCell.getAttribute('data-label')),
      headerHidden: getComputedStyle(t.querySelector('thead')).display === 'none',
    };
  });

  expect(info.found).toBe(true);
  expect(info.stacked).toBe(true);
  expect(info.labelled).toBe(true);
  expect(info.headerHidden).toBe(true);
});

test('desktop keeps real table rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubApi(page);
  await page.addInitScript(() => window.sessionStorage.setItem('greenwave.session.token', 't'));
  await page.goto('/');
  await page.waitForSelector('#nav', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.navitem[data-view="history"]').click());
  await page.waitForTimeout(600);

  const headerVisible = await page.evaluate(() => {
    const t = document.querySelector('#v-history table.table');
    return getComputedStyle(t.querySelector('thead')).display !== 'none';
  });
  expect(headerVisible).toBe(true);
});

test('primary touch targets are large enough on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubApi(page);
  await page.addInitScript(() => window.sessionStorage.setItem('greenwave.session.token', 't'));
  await page.goto('/');
  await page.waitForSelector('#nav', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.navitem[data-view="inventory"]').click());
  await page.waitForTimeout(400);
  await page.click('#btnReceiveStock');
  await page.waitForSelector('#inboundPhotoGrid', { state: 'attached' });

  const small = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#modalWrap button:not([hidden])').forEach((b) => {
      const r = b.getBoundingClientRect();
      if (r.height > 0 && r.height < 36) bad.push((b.id || b.className) + ' h=' + Math.round(r.height));
    });
    return bad;
  });
  expect(small, 'Controls under 36px tall in the inbound modal: ' + small.join(', ')).toEqual([]);
});
