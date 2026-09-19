const { test, expect } = require('@playwright/test');

/**
 * Inventory photo picker — up to 15 photos per entry.
 *
 * Runs against a stubbed API rather than the live NestJS process: this suite's
 * other specs need Postgres, Redis and MinIO, and the behaviour under test
 * here is entirely client-side (selection, preview, counter, removal, and what
 * ends up in the request body). The server-side half of the same rule is
 * covered by src/photos/multi-photo-upload.spec.ts.
 */

const WAREHOUSE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Maple Ridge',
  code: 'MR-BC',
  province: 'BC',
  division: 'greenwave',
};

const MATERIAL = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'OCC Cardboard',
  category: 'paper',
  unit: 'kg',
  division: 'greenwave',
};

/* A real 1x1 JPEG — Photos.prepare() decodes it through an <img>, so the
   bytes have to be a genuinely decodable image. */
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const photoFile = (name) => ({
  name,
  mimeType: 'image/jpeg',
  buffer: JPEG_1PX,
});

const photoFiles = (n, prefix = 'load') =>
  Array.from({ length: n }, (_, i) => photoFile(`${prefix}-${i + 1}.jpg`));

async function stubApi(page, opts = {}) {
  const uploaded = { batches: [], transactions: [], deleted: [] };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (path === '/auth/me') {
      return json({
        id: 1,
        email: 'admin@greenwave.test',
        fullName: 'Admin User',
        role: 'admin',
        permissions: ['warehouses:global_access'],
        hasGlobalAccess: true,
        // Nav is gated on the divisions the server grants this session.
        divisions: [{ key: 'greenwave' }, { key: 'healthcare' }],
      });
    }
    if (path === '/warehouses') return json([WAREHOUSE]);
    if (path === '/divisions' || path === '/divisions/catalog') {
      return json([
        { id: 'greenwave', key: 'greenwave', name: 'Recycling', code: 'greenwave' },
        { id: 'healthcare', key: 'healthcare', name: 'Healthcare', code: 'healthcare' },
      ]);
    }
    if (path === '/materials') return json([MATERIAL]);
    if (path === '/photos/batch' && req.method() === 'POST') {
      // Count how many `files` parts actually arrived.
      const body = req.postData() || '';
      const count = (body.match(/name="files"/g) || []).length;
      uploaded.batches.push(count);
      if (opts.batchStatus === 413) {
        // What production's nginx sent back before client_max_body_size was
        // raised: an HTML page, not the API's JSON.
        return route.fulfill({ status: 413, contentType: 'text/html', body: '<html><body><h1>413 Request Entity Too Large</h1></body></html>' });
      }
      return json(
        Array.from({ length: count }, (_, i) => ({
          id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
          url: `/api/photos/p${i + 1}/view`,
        })),
      );
    }
    if (path === '/inventory/transactions' && req.method() === 'POST') {
      uploaded.transactions.push(JSON.parse(req.postData() || '{}'));
      if (opts.txStatus) return json({ message: 'Material not found' }, opts.txStatus);
      return json({ id: 'tx-1' }, 201);
    }
    if (path === '/inventory/transactions/tx-1') {
      const last = uploaded.transactions[uploaded.transactions.length - 1] || {};
      return json({ id: 'tx-1', photos: (last.photoIds || []).map((id) => ({ id })) });
    }
    if (path.startsWith('/photos/') && req.method() === 'DELETE') {
      uploaded.deleted.push(path.slice('/photos/'.length));
      return json({ ok: true });
    }
    if (path === '/inventory/transactions') return json([]);
    if (path === '/inventory/balances') return json([]);
    if (path === '/containers') return json([]);
    return json([]);
  });

  return uploaded;
}

async function openInboundModal(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('greenwave.session.token', 'test-token');
  });
  await page.goto('/');
  await page.waitForSelector('#nav', { timeout: 15000 });
  await page.click('.navitem[data-view="inventory"]');
  await page.waitForSelector('#v-inventory.view', { state: 'visible' });
  await page.click('#btnReceiveStock');
  await page.waitForSelector('#inboundPhotoGrid', { state: 'attached' });
}

test.describe('inventory photo picker', () => {
  test('starts empty and shows the 15-photo limit', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await expect(page.locator('#inboundPhotoCount')).toHaveText('0 / 15');
    await expect(page.locator('#inboundPhotoGrid')).toBeHidden();
  });

  test('keeps every photo from a multi-select (not just the first)', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(4));

    await expect(page.locator('#inboundPhotoCount')).toHaveText('4 / 15');
    await expect(page.locator('.photo-chip')).toHaveCount(4);
  });

  test('adds to the existing selection rather than replacing it', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(3, 'first'));
    await expect(page.locator('#inboundPhotoCount')).toHaveText('3 / 15');

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(2, 'second'));
    await expect(page.locator('#inboundPhotoCount')).toHaveText('5 / 15');
    await expect(page.locator('.photo-chip')).toHaveCount(5);
  });

  test('removes an individual photo before submitting', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(3));
    await page.locator('.photo-chip-x').nth(1).click();

    await expect(page.locator('#inboundPhotoCount')).toHaveText('2 / 15');
    await expect(page.locator('.photo-chip')).toHaveCount(2);
  });

  test('accepts exactly 15', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(15));
    await expect(page.locator('#inboundPhotoCount')).toHaveText('15 / 15');
    await expect(page.locator('#inboundPhotoCount')).toHaveClass(/is-full/);
  });

  test('refuses a 16th photo and explains the limit', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(16));

    // 15 kept, and the operator is told rather than losing one silently.
    await expect(page.locator('#inboundPhotoCount')).toHaveText('15 / 15');
    await expect(page.locator('.photo-chip')).toHaveCount(15);
    await expect(page.locator('.toast')).toContainText('maximum of 15 photos');
  });

  test('ignores a repeated selection of the same photo', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    /* Real files on disk, so both selections produce File objects with the
       same name, size and lastModified — which is what the browser hands over
       when an operator picks the same photo from the library twice. Buffers
       built in-test get a fresh lastModified each call and are, correctly,
       treated as distinct photos. */
    const fixture = require('path').join(__dirname, '..', 'fixtures', 'test-photo.jpg');

    await page.setInputFiles('#inboundPhotoLibrary', [fixture]);
    await expect(page.locator('#inboundPhotoCount')).toHaveText('1 / 15');

    await page.setInputFiles('#inboundPhotoLibrary', [fixture]);
    await expect(page.locator('#inboundPhotoCount')).toHaveText('1 / 15');
    await expect(page.locator('.toast')).toContainText('already added');
  });

  test('uploads every selected photo and sends all ids with the entry', async ({ page }) => {
    const uploaded = await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(5));
    await page.fill('input[name="orderNumber"]', 'ORD-15PHOTO');
    await page.fill('input[name="weightValue"]', '3658');
    await page.fill('input[name="palletQty"]', '3');
    await page.click('#modalOk');

    await expect
      .poll(() => uploaded.transactions.length, { timeout: 20000 })
      .toBe(1);

    // All five left the browser in one request...
    expect(uploaded.batches).toEqual([5]);
    // ...and all five ids are attached to the entry, with the first as cover.
    const tx = uploaded.transactions[0];
    expect(tx.photoIds).toHaveLength(5);
    expect(tx.photoId).toBe(tx.photoIds[0]);
  });

  test('reports the saved photo count once the entry is read back', async ({ page }) => {
    await stubApi(page);
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(3));
    await page.fill('input[name="orderNumber"]', 'ORD-READBACK');
    await page.fill('input[name="weightValue"]', '100');
    await page.fill('input[name="palletQty"]', '1');
    await page.click('#modalOk');

    await expect(page.locator('.toast')).toContainText('with 3 photos', { timeout: 20000 });
  });

  /* The production bug: nginx refused the batch with a 413 and the entry
     was then saved without photos under a success message. Nothing may be
     saved, and the operator must be able to retry with the same selection. */
  test('does not save the entry when the photo upload is rejected', async ({ page }) => {
    const uploaded = await stubApi(page, { batchStatus: 413 });
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(3));
    await page.fill('input[name="orderNumber"]', 'ORD-413');
    await page.fill('input[name="weightValue"]', '100');
    await page.fill('input[name="palletQty"]', '1');
    await page.click('#modalOk');

    await expect(page.locator('.toast')).toContainText('Nothing was saved', { timeout: 20000 });
    expect(uploaded.batches).toEqual([3]);
    expect(uploaded.transactions).toEqual([]);
    await expect(page.locator('#modalWrap')).toBeVisible();
    await expect(page.locator('#inboundPhotoCount')).toHaveText('3 / 15');
    await expect(page.locator('#modalOk')).toBeEnabled();
  });

  test('removes uploaded photos and does not retry when the entry fails to save', async ({ page }) => {
    const uploaded = await stubApi(page, { txStatus: 400 });
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(2));
    await page.fill('input[name="orderNumber"]', 'ORD-TXFAIL');
    await page.fill('input[name="weightValue"]', '100');
    await page.fill('input[name="palletQty"]', '1');
    await page.click('#modalOk');

    await expect(page.locator('.toast')).toContainText('Material not found', { timeout: 20000 });
    // One attempt only -- the old flow re-posted the entry without photos.
    expect(uploaded.transactions).toHaveLength(1);
    await expect.poll(() => uploaded.deleted.length).toBe(2);
    await expect(page.locator('#modalWrap')).toBeVisible();
  });

  /* A 5xx may come after the entry and its photo links were committed, and
     deleting a photo removes its MinIO object first -- so nothing is
     cleaned up here; an orphan is the safe outcome. */
  test('keeps uploaded photos when the entry save fails server-side', async ({ page }) => {
    const uploaded = await stubApi(page, { txStatus: 500 });
    await openInboundModal(page);

    await page.setInputFiles('#inboundPhotoLibrary', photoFiles(2));
    await page.fill('input[name="orderNumber"]', 'ORD-TX500');
    await page.fill('input[name="weightValue"]', '100');
    await page.fill('input[name="palletQty"]', '1');
    await page.click('#modalOk');

    await expect(page.locator('.toast')).toContainText('Material not found', { timeout: 20000 });
    expect(uploaded.transactions).toHaveLength(1);
    await page.waitForTimeout(500);
    expect(uploaded.deleted).toEqual([]);
  });

  test('saves an entry with no photos at all', async ({ page }) => {
    const uploaded = await stubApi(page);
    await openInboundModal(page);

    await page.fill('input[name="orderNumber"]', 'ORD-NOPHOTO');
    await page.fill('input[name="weightValue"]', '1200');
    await page.fill('input[name="palletQty"]', '2');
    await page.click('#modalOk');

    await expect
      .poll(() => uploaded.transactions.length, { timeout: 20000 })
      .toBe(1);
    expect(uploaded.batches).toEqual([]);
    expect(uploaded.transactions[0].photoIds).toBeUndefined();
  });
});
