const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

const TEST_PHOTO = path.join(__dirname, '..', 'fixtures', 'test-photo.jpg');

async function selectFacility(page, label) {
  await page.selectOption('#wh', { label });
}

async function selectDivision(page, division) {
  await page.click(division === 'recycling' ? '#topDivRecycling' : '#topDivHealthcare');
  await page.waitForSelector('#invenBody .table, #invenBody .empty');
}

/**
 * Reads the "Current Stock" cell for a given material's row in the
 * inventory table. Column layout differs by division: Recycling is
 * Product/Category/Current-Stock/…(index 2); Healthcare inserts XL/L/M/S
 * before it, so Current Stock is index 6 there.
 */
async function currentStock(page, materialName, division) {
  const row = page.locator('#invenBody tr', { hasText: materialName });
  await row.waitFor({ state: 'visible' });
  const stockColumnIndex = division === 'healthcare' ? 6 : 2;
  const text = await row.locator('td').nth(stockColumnIndex).innerText();
  return Number(text.replace(/[^0-9.-]/g, ''));
}

test.describe('Inventory — Inbound (Receive)', () => {
  test('Recycling: facility + division select, pallet/weight/KG-LB/container/seal/photo/notes, saves and updates stock', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');

    await selectFacility(page, 'Calgary, AB');
    await selectDivision(page, 'recycling');

    const before = await currentStock(page, 'Mixed Electronics');

    await page.click('#btnReceiveStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await expect(page.locator('#modalTitle')).toContainText('Receive Inbound (PALLETS)');

    const form = page.locator('#modalForm');
    await form.locator('input[name="orderNumber"]').fill('E2E-INBOUND-REC-001');
    await form.locator('select[name="materialId"]').selectOption({ label: 'Mixed Electronics' });
    await form.locator('input[name="weightValue"]').fill('1250.5');
    await expect(form.locator('select[name="weightUnit"]')).toHaveValue('kg');
    await form.locator('select[name="weightUnit"]').selectOption('lb');
    await expect(form.locator('select[name="weightUnit"]')).toHaveValue('lb');
    await form.locator('input[name="palletQty"]').fill('3');
    await form.locator('input[name="containerNumber"]').fill('MSMU 6896930');
    await form.locator('input[name="sealNumber"]').fill('0336695');
    await form.locator('input[name="notes"]').fill('E2E inbound recycling test');

    await expect(page.locator('#modalAutoTotal')).toHaveText('3 PALLETS');

    // Photo capture
    await page.setInputFiles('#inboundPhotoInput', TEST_PHOTO);
    await expect(page.locator('#inboundPhotoPreviewWrap')).toBeVisible();
    await expect(page.locator('#inboundPhotoName')).toContainText('test-photo.jpg');

    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect
      .poll(() => currentStock(page, 'Mixed Electronics'))
      .toBe(before + 3);
  });

  test('Healthcare: facility + division select, XL/L/M/S, container/seal/photo/notes, saves and updates stock', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');

    await selectFacility(page, 'Calgary, AB');
    await selectDivision(page, 'healthcare');

    const before = await currentStock(page, 'Synguard 100', 'healthcare');

    await page.click('#btnReceiveStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await expect(page.locator('#modalTitle')).toContainText('Receive Inbound (BOXES)');

    const form = page.locator('#modalForm');
    // Recycling-only fields must not be present in the Healthcare form.
    await expect(form.locator('input[name="weightValue"]')).toHaveCount(0);
    await expect(form.locator('input[name="palletQty"]')).toHaveCount(0);

    await form.locator('input[name="orderNumber"]').fill('E2E-INBOUND-HC-001');
    await form.locator('select[name="materialId"]').selectOption({ label: 'Synguard 100' });
    await form.locator('input[name="containerNumber"]').fill('MSMU 1122334');
    await form.locator('input[name="sealNumber"]').fill('9988776');
    await form.locator('input[name="xl"]').fill('2');
    await form.locator('input[name="l"]').fill('3');
    await form.locator('input[name="m"]').fill('1');
    await form.locator('input[name="s"]').fill('4');
    await form.locator('input[name="notes"]').fill('E2E inbound healthcare test');

    await expect(page.locator('#modalAutoTotal')).toHaveText('10 BOXES');

    await page.setInputFiles('#inboundPhotoInput', TEST_PHOTO);
    await expect(page.locator('#inboundPhotoPreviewWrap')).toBeVisible();

    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect
      .poll(() => currentStock(page, 'Synguard 100', 'healthcare'))
      .toBe(before + 10);
  });
});

test.describe('Inventory — Outbound (Ship)', () => {
  test('Recycling: PALLET quantity ships and reduces stock', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');

    await selectFacility(page, 'Calgary, AB');
    await selectDivision(page, 'recycling');

    // Ensure there is enough stock to ship from.
    await page.click('#btnReceiveStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const receiveForm = page.locator('#modalForm');
    await receiveForm.locator('input[name="orderNumber"]').fill('E2E-OUTBOUND-SETUP');
    await receiveForm.locator('select[name="materialId"]').selectOption({ label: 'Non-Ferrous Scrap' });
    await receiveForm.locator('input[name="weightValue"]').fill('500');
    await receiveForm.locator('input[name="palletQty"]').fill('5');
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    const before = await currentStock(page, 'Non-Ferrous Scrap');

    await page.click('#btnShipStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await expect(page.locator('#modalTitle')).toContainText('Ship Outbound (PALLETS)');

    const form = page.locator('#modalForm');
    await form.locator('input[name="orderNumber"]').fill('E2E-OUTBOUND-REC-001');
    await form.locator('select[name="materialId"]').selectOption({ label: 'Non-Ferrous Scrap' });
    await form.locator('input[name="palletQty"]').fill('2');
    await form.locator('input[name="containerNumber"]').fill('TRAILER-9001');
    await form.locator('input[name="sealNumber"]').fill('0001122');
    await form.locator('input[name="notes"]').fill('E2E outbound recycling test');

    await expect(page.locator('#modalAutoTotal')).toHaveText('2 PALLETS');

    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect
      .poll(() => currentStock(page, 'Non-Ferrous Scrap'))
      .toBe(before - 2);
  });

  test('Healthcare: BOX / XL-L-M-S ships, no weight field, and reduces stock', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');

    await selectFacility(page, 'Calgary, AB');
    await selectDivision(page, 'healthcare');

    // Ensure there is enough stock to ship from.
    await page.click('#btnReceiveStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const receiveForm = page.locator('#modalForm');
    await receiveForm.locator('input[name="orderNumber"]').fill('E2E-OUTBOUND-HC-SETUP');
    await receiveForm.locator('select[name="materialId"]').selectOption({ label: 'Robust 100' });
    await receiveForm.locator('input[name="xl"]').fill('5');
    await receiveForm.locator('input[name="l"]').fill('5');
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    const before = await currentStock(page, 'Robust 100', 'healthcare');

    await page.click('#btnShipStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    await expect(page.locator('#modalTitle')).toContainText('Ship Outbound (BOXES)');

    const form = page.locator('#modalForm');
    // No weight field anywhere in the healthcare (box-based) outbound form.
    await expect(form.locator('input[name="weightValue"]')).toHaveCount(0);
    await expect(page.locator('#modalWrap')).not.toContainText('Weight');

    await form.locator('input[name="orderNumber"]').fill('E2E-OUTBOUND-HC-001');
    await form.locator('select[name="materialId"]').selectOption({ label: 'Robust 100' });
    await form.locator('input[name="xl"]').fill('1');
    await form.locator('input[name="l"]').fill('2');
    await form.locator('input[name="notes"]').fill('E2E outbound healthcare test');

    await expect(page.locator('#modalAutoTotal')).toHaveText('3 BOXES');

    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await expect
      .poll(() => currentStock(page, 'Robust 100', 'healthcare'))
      .toBe(before - 3);
  });

  test('Recycling outbound form has no XL/L/M/S size fields (pallet-only)', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');
    await selectFacility(page, 'Calgary, AB');
    await selectDivision(page, 'recycling');

    await page.click('#btnShipStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const form = page.locator('#modalForm');
    await expect(form.locator('input[name="xl"]')).toHaveCount(0);
    await expect(form.locator('input[name="l"]')).toHaveCount(0);
    await page.click('#modalCancel');
  });
});

test.describe('Inventory — Inbound/Outbound warehouse isolation', () => {
  test('an inbound transaction recorded for Calgary does not change Ontario stock for the same material', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="inventory"]');
    await page.waitForSelector('#v-inventory.view.active');

    await selectFacility(page, 'Ontario');
    await selectDivision(page, 'recycling');
    const ontarioBefore = await currentStock(page, 'Mixed Electronics');

    await selectFacility(page, 'Calgary, AB');
    await selectDivision(page, 'recycling');

    await page.click('#btnReceiveStock');
    await page.waitForSelector('#modalWrap:not([hidden])');
    const form = page.locator('#modalForm');
    await form.locator('input[name="orderNumber"]').fill('E2E-ISOLATION-CGY');
    await form.locator('select[name="materialId"]').selectOption({ label: 'Mixed Electronics' });
    await form.locator('input[name="weightValue"]').fill('100');
    await form.locator('input[name="palletQty"]').fill('4');
    await page.click('#modalOk');
    await page.waitForSelector('#modalWrap', { state: 'hidden' });

    await selectFacility(page, 'Ontario');
    await selectDivision(page, 'recycling');
    await expect
      .poll(() => currentStock(page, 'Mixed Electronics'))
      .toBe(ontarioBefore);
  });
});
