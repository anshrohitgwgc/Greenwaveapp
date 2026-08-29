const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WAREHOUSE_CGY = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE_ON = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_MR = '11111111-1111-4111-8111-111111111111';

const sampleWarehouses = [
  { id: WAREHOUSE_CGY, name: 'Calgary, AB', code: 'CGY', province: 'AB', active: true },
  { id: WAREHOUSE_ON, name: 'Ontario', code: 'ON', province: 'ON', active: true },
  { id: WAREHOUSE_MR, name: 'Maple Ridge, BC', code: 'MR', province: 'BC', active: true }
];

const sampleUsers = [
  {
    id: 1,
    fullName: 'System Administrator',
    name: 'System Administrator',
    email: 'admin@greenwaverecycling.ca',
    role: 'admin',
    createdAt: '2026-08-01T08:00:00Z',
    warehouses: sampleWarehouses
  },
  {
    id: 2,
    fullName: 'Manager Calgary & Ontario',
    name: 'Manager Calgary & Ontario',
    email: 'manager.cgy.on@greenwaverecycling.ca',
    role: 'manager',
    createdAt: '2026-08-05T09:30:00Z',
    warehouses: [sampleWarehouses[0], sampleWarehouses[1]]
  },
  {
    id: 3,
    fullName: 'Calgary Staff Member',
    name: 'Calgary Staff Member',
    email: 'staff.cgy@greenwaverecycling.ca',
    role: 'staff',
    createdAt: '2026-08-10T10:15:00Z',
    warehouses: [sampleWarehouses[0]]
  },
  {
    id: 4,
    fullName: 'Ontario Driver',
    name: 'Ontario Driver',
    email: 'driver.on@greenwaverecycling.ca',
    role: 'driver',
    createdAt: '2026-08-12T11:00:00Z',
    warehouses: [sampleWarehouses[1]]
  }
];

const inventoryData = {
  [WAREHOUSE_CGY]: {
    balances: [
      { id: 'b1', warehouseId: WAREHOUSE_CGY, materialId: 'm1', balance: '1000', xlBalance: '250', lBalance: '250', mBalance: '250', sBalance: '250', updatedAt: '2026-08-28T18:00:00Z' },
      { id: 'b2', warehouseId: WAREHOUSE_CGY, materialId: 'm2', balance: '450', xlBalance: '100', lBalance: '150', mBalance: '100', sBalance: '100', updatedAt: '2026-08-28T18:30:00Z' }
    ],
    transactions: [
      { id: 'tx-cgy-1', warehouseId: WAREHOUSE_CGY, materialId: 'm1', type: 'inbound', xl: '250', l: '250', m: '250', s: '250', total: '1000', orderNumber: 'TEST-CGY-IN-001', createdAt: '2026-08-28T14:30:00Z' },
      { id: 'tx-cgy-2', warehouseId: WAREHOUSE_CGY, materialId: 'm2', type: 'inbound', xl: '100', l: '150', m: '100', s: '100', total: '450', orderNumber: 'TEST-CGY-IN-002', createdAt: '2026-08-28T15:00:00Z' }
    ],
    containers: [
      { id: 'c-cgy-1', warehouseId: WAREHOUSE_CGY, orderNumber: 'TEST-CGY', containerNumber: 'MSMU-CGY-1001', sealNumber: 'SEAL-CGY-01', productName: 'Synguard 100', total: '1000', status: 'received', createdAt: '2026-08-28T14:30:00Z' }
    ]
  },
  [WAREHOUSE_ON]: {
    balances: [
      { id: 'b3', warehouseId: WAREHOUSE_ON, materialId: 'm1', balance: '2500', xlBalance: '625', lBalance: '625', mBalance: '625', sBalance: '625', updatedAt: '2026-08-28T17:00:00Z' }
    ],
    transactions: [
      { id: 'tx-on-1', warehouseId: WAREHOUSE_ON, materialId: 'm1', type: 'inbound', xl: '625', l: '625', m: '625', s: '625', total: '2500', orderNumber: 'TEST-ON-IN-001', createdAt: '2026-08-28T11:00:00Z' }
    ],
    containers: [
      { id: 'c-on-1', warehouseId: WAREHOUSE_ON, orderNumber: 'TEST-ON', containerNumber: 'TGHU-ON-2001', sealNumber: 'SEAL-ON-01', productName: 'Synguard 200', total: '2500', status: 'received', createdAt: '2026-08-28T11:00:00Z' }
    ]
  },
  [WAREHOUSE_MR]: {
    balances: [
      { id: 'b4', warehouseId: WAREHOUSE_MR, materialId: 'm1', balance: '750', xlBalance: '200', lBalance: '200', mBalance: '200', sBalance: '150', updatedAt: '2026-08-28T19:00:00Z' }
    ],
    transactions: [
      { id: 'tx-mr-1', warehouseId: WAREHOUSE_MR, materialId: 'm1', type: 'inbound', xl: '200', l: '200', m: '200', s: '150', total: '750', orderNumber: 'TEST-MR-IN-001', createdAt: '2026-08-28T16:00:00Z' }
    ],
    containers: [
      { id: 'c-mr-1', warehouseId: WAREHOUSE_MR, orderNumber: 'TEST-MR', containerNumber: 'MSMU-MR-3001', sealNumber: 'SEAL-MR-01', productName: 'Synguard 100', total: '750', status: 'received', createdAt: '2026-08-28T16:00:00Z' }
    ]
  }
};

const sampleMaterials = [
  { id: 'm1', name: 'Synguard 100 (Latex Gloves)', category: 'gloves', unit: 'cases', defaultPrice: '45.00', active: true },
  { id: 'm2', name: 'Mixed Rigid Plastics', category: 'plastics', unit: 'kg', defaultPrice: '0.65', active: true }
];

const sampleInvoices = [
  {
    id: 'inv-1',
    invoiceNumber: '1115',
    invoiceDate: '2026-08-28',
    dueDate: '2026-09-12',
    billTo: 'Acme Recycling Partners Inc.\n1234 Industrial Way\nCalgary, AB T2P 1A1',
    shipTo: 'Acme Facility #4\n5678 Logistics Blvd\nCalgary, AB T2P 2B2',
    reference: 'sd',
    poReference: 'PO-2026-8891',
    fromLocation: 'Maple Ridge, BC',
    companyInfo: {
      name: 'Greenwave Recycling Inc.',
      bn: 'BN 751161951BC0001',
      gst: 'GST/HST Registration No. 751161951RT0001',
      line1: '23394 Fisherman Rd,',
      line2: 'Maple Ridge, BC V2W 1B9',
      email: 'sales@greenwaverecycling.ca',
      phone: '6724720423'
    },
    items: [
      { id: 'item-1', description: 'sgfs', unit: '10', quantity: 1, unitPrice: 10000, discount: 1, isRebate: false, lineTotal: 9999 }
    ],
    taxLabel: 'GST @ 5%',
    taxRate: 5,
    taxTotal: '499.95',
    subtotal: '9999.00',
    total: '10498.95',
    paymentInstructions: 'sales@greenwaverecycling.ca\n6724720423',
    status: 'draft',
    warehouseId: WAREHOUSE_CGY
  }
];

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(__dirname, '../..', reqPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

async function run() {
  await new Promise((resolve) => server.listen(8765, resolve));
  console.log('Static server listening on http://localhost:8765');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let currentUser = sampleUsers[0]; // Admin
  let selectedWhId = WAREHOUSE_CGY;

  // Intercept API routes
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (!['/auth', '/users', '/warehouses', '/inventory', '/containers', '/invoices', '/photos', '/timesheets', '/customers', '/materials', '/chat', '/audit'].some(p => pathname.startsWith(p))) {
      return route.continue();
    }

    // Auth endpoints
    if (pathname === '/auth/login' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock_jwt_token',
          user: currentUser
        })
      });
    }
    if (pathname === '/auth/me' || pathname === '/users/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentUser)
      });
    }
    if (pathname === '/auth/register' && method === 'POST') {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Public registration is disabled.' })
      });
    }

    // Warehouses
    if (pathname === '/warehouses') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleWarehouses)
      });
    }

    // Users / Staff
    if (pathname === '/users' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleUsers)
      });
    }
    if (pathname.match(/^\/users\/(\d+)\/warehouses$/)) {
      const uId = Number(pathname.split('/')[2]);
      const target = sampleUsers.find(u => u.id === uId) || sampleUsers[0];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(target.warehouses || [])
      });
    }

    // Materials
    if (pathname === '/materials') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleMaterials)
      });
    }

    // Inventory
    if (pathname === '/inventory/balances') {
      const whId = url.searchParams.get('warehouseId') || selectedWhId;
      const data = inventoryData[whId] ? inventoryData[whId].balances : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data)
      });
    }
    if (pathname === '/inventory/transactions') {
      const whId = url.searchParams.get('warehouseId') || selectedWhId;
      const data = inventoryData[whId] ? inventoryData[whId].transactions : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data)
      });
    }
    if (pathname === '/containers') {
      const whId = url.searchParams.get('warehouseId') || selectedWhId;
      const data = inventoryData[whId] ? inventoryData[whId].containers : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data)
      });
    }

    // Invoices
    if (pathname === '/invoices') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sampleInvoices)
      });
    }

    // Customers
    if (pathname === '/customers') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }

    // Audit
    if (pathname === '/audit') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }

    // Chat
    if (pathname === '/chat/messages') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'c1', senderId: 1, senderName: 'System Administrator', senderRole: 'admin', message: 'Welcome to GreenWave Operations Platform.', createdAt: '2026-08-28T12:00:00Z' }
        ])
      });
    }
    if (pathname === '/chat/online') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ onlineCount: 3, users: ['System Administrator', 'Manager Calgary', 'Calgary Staff'] })
      });
    }

    // Timesheets
    if (pathname === '/timesheets/me/current') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(null)
      });
    }

    // Photos
    if (pathname === '/photos') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // 1. Screenshot 1: Login Page
  await page.goto('http://localhost:8765');
  await page.waitForSelector('#gate', { state: 'visible' });
  await page.screenshot({ path: '/tmp/evidence_screenshots/1_login_page.png' });
  console.log('Saved: 1_login_page.png');

  // Sign In as Admin
  await page.evaluate(() => {
    sessionStorage.setItem('greenwave.session.token', 'mock_jwt_token');
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
  });

  // Boot the app
  await page.evaluate(async () => {
    const user = await window.GreenwaveApi.me();
    window.Store.setServerSession(user);
    const whs = await window.GreenwaveApi.listWarehouses(false);
    window.warehouses = whs;
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    window.location.reload();
  });

  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForTimeout(600);

  // 8. Screenshot 8: Desktop UI Overview
  await page.screenshot({ path: '/tmp/evidence_screenshots/8_desktop_ui.png' });
  console.log('Saved: 8_desktop_ui.png');

  // 3. Screenshot 3: Calgary Inventory
  selectedWhId = WAREHOUSE_CGY;
  await page.selectOption('#wh', WAREHOUSE_CGY);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/evidence_screenshots/3_inventory_calgary.png' });
  console.log('Saved: 3_inventory_calgary.png');

  // 4. Screenshot 4: Ontario Inventory
  selectedWhId = WAREHOUSE_ON;
  await page.selectOption('#wh', WAREHOUSE_ON);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/evidence_screenshots/4_inventory_ontario.png' });
  console.log('Saved: 4_inventory_ontario.png');

  // 5. Screenshot 5: Maple Ridge Inventory
  selectedWhId = WAREHOUSE_MR;
  await page.selectOption('#wh', WAREHOUSE_MR);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/evidence_screenshots/5_inventory_maple_ridge.png' });
  console.log('Saved: 5_inventory_maple_ridge.png');

  // 2. Screenshot 2: Staff Management & Permissions Screen
  await page.click('[data-view="staff"]');
  await page.waitForTimeout(500);
  const editButtons = await page.$$('.btn-edit-user-access');
  if (editButtons.length >= 3) {
    await editButtons[2].click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: '/tmp/evidence_screenshots/2_staff_warehouse_permissions.png' });
  console.log('Saved: 2_staff_warehouse_permissions.png');

  // Close modal
  await page.click('#modalCancel');
  await page.waitForTimeout(200);

  // 6. Screenshot 6: Invoice Editor
  await page.click('[data-view="invoices"]');
  await page.waitForTimeout(400);
  await page.click('[data-invoice="inv-1"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/evidence_screenshots/6_invoice_editor.png', fullPage: true });
  console.log('Saved: 6_invoice_editor.png');

  // 7. Screenshot 7: Invoice Rendered / Print Preview
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: '/tmp/evidence_screenshots/7_invoice_print_preview.png', fullPage: true });
  console.log('Saved: 7_invoice_print_preview.png');
  await page.emulateMedia({ media: 'screen' });

  // 9. Screenshot 9: Mobile UI
  // 390x844
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    var invView = document.querySelector('[data-view="inventory"]');
    if (invView) invView.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/evidence_screenshots/9_mobile_390x844.png' });
  console.log('Saved: 9_mobile_390x844.png');

  // 430x932
  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/evidence_screenshots/9_mobile_430x932.png' });
  console.log('Saved: 9_mobile_430x932.png');

  // 768x1024
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/evidence_screenshots/9_tablet_768x1024.png' });
  console.log('Saved: 9_tablet_768x1024.png');

  await browser.close();
  server.close();
  console.log('ALL EVIDENCE SCREENSHOTS GENERATED SUCCESSFULLY');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
