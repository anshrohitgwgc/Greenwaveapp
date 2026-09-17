const { test, expect } = require('@playwright/test');

const VIEWS = ['dashboard','inventory','history','products','customers','invoices','purchaseorders','payments','photos','staff','timeclock','chat','settings','araging','employees','attendance','payables','banking','reconciliation','chartofaccounts','generalledger','profitloss','balancesheet','leaverequests'];

test('no console errors across every view', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/auth/me') return json({ id: 1, email: 'a@b.c', fullName: 'Admin User', role: 'admin', permissions: ['warehouses:global_access'], hasGlobalAccess: true, divisions: [{ key: 'greenwave' }, { key: 'healthcare' }] });
    if (p === '/warehouses') return json([{ id: '11111111-1111-4111-8111-111111111111', name: 'Maple Ridge', code: 'MR-BC', division: 'greenwave' }]);
    if (p === '/materials') return json([{ id: '22222222-2222-4222-8222-222222222222', name: 'OCC Cardboard', unit: 'kg', division: 'greenwave' }]);
    if (p === '/timesheets/me/current') return json(null);
    if (p === '/purchase-orders/next-number') return json({ poNumber: 'PO-2026-1001' });
    if (p === '/invoices/next-number') return json({ invoiceNumber: 10001 });
    return json([]);
  });

  await page.addInitScript(() => window.sessionStorage.setItem('greenwave.session.token', 't'));
  await page.goto('/');
  await page.waitForSelector('#nav', { timeout: 15000 });

  for (const v of VIEWS) {
    await page.evaluate((view) => {
      const b = document.querySelector('.navitem[data-view="' + view + '"]');
      if (b) b.click();
    }, v);
    await page.waitForTimeout(300);
  }

  /* Favicon/font noise is not an application error, and the chat EventSource
     legitimately rejects this suite's JSON stub because it is not an SSE
     stream -- that is the stub's shape, not the app's behaviour. */
  const real = errors.filter(
    (e) => !/favicon|font|net::ERR_|EventSource/i.test(e),
  );
  expect(real, 'Console errors:\n' + real.join('\n')).toEqual([]);
});
