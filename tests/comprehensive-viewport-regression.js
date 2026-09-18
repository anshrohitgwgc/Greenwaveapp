const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT_DIR, 'test-results', 'viewport-regression');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const PORT = 8089;
const APP_URL = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, isMobile: false },
  { name: 'mobile-360x800', width: 360, height: 800, isMobile: true },
  { name: 'mobile-390x844', width: 390, height: 844, isMobile: true },
  { name: 'mobile-430x932', width: 430, height: 932, isMobile: true },
];

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Start simple static server
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(ROOT_DIR, reqPath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Server] Serving ${ROOT_DIR} on ${APP_URL}`);
      resolve(server);
    });
  });
}

// Mock API responses for full offline fidelity
const MOCK_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@greenwave.local',
  fullName: 'System Admin',
  name: 'System Admin',
  role: 'admin',
  active: true,
  divisions: ['recycling', 'healthcare'],
  warehouses: [
    { id: 'b0000000-0000-4000-8000-000000000001', name: 'Mississauga Facility', city: 'Mississauga', code: 'REC-MISS' },
    { id: 'b0000000-0000-4000-8000-000000000003', name: 'Ontario Distribution', city: 'Mississauga', code: 'ON-MAIN' },
    { id: 'b0000000-0000-4000-8000-000000000002', name: 'Calgary Depot', city: 'Calgary', code: 'CGY-AB' }
  ]
};

const MOCK_WAREHOUSES = [
  { id: 'b0000000-0000-4000-8000-000000000001', name: 'Mississauga Facility', city: 'Mississauga', code: 'REC-MISS', division: 'recycling', active: true },
  { id: 'b0000000-0000-4000-8000-000000000003', name: 'Ontario Distribution', city: 'Mississauga', code: 'ON-MAIN', division: 'healthcare', active: true },
  { id: 'b0000000-0000-4000-8000-000000000002', name: 'Calgary Depot', city: 'Calgary', code: 'CGY-AB', division: 'healthcare', active: true }
];

const MOCK_PROFORMAS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    proformaNumber: 'PRO-2026-0001',
    divisionId: 'recycling',
    warehouseId: 'b0000000-0000-4000-8000-000000000001',
    customerId: 'cust-001',
    customerName: 'Acme Metal Refining Corp',
    customerEmail: 'billing@acmemetal.com',
    issueDate: '2026-09-17',
    expiryDate: '2026-10-17',
    status: 'draft',
    subtotal: 1250000,
    taxRate: 13,
    taxAmount: 162500,
    total: 1412500,
    currency: 'CAD',
    incoterm: 'FOB',
    destination: 'Hamilton Port, ON',
    poReference: 'PO-REF-99201',
    paymentTerms: 'Net 30',
    notes: 'Preliminary commercial quote for recovered copper and aluminum.',
    items: [
      { id: 'item-1', description: 'Clean Copper Wire (No. 1)', quantity: 2500, unit: 'lbs', unitPrice: 420, total: 1050000, tareWeight: 50, netWeight: 2450 },
      { id: 'item-2', description: 'Aluminum Extrusions', quantity: 1000, unit: 'lbs', unitPrice: 200, total: 200000, tareWeight: 20, netWeight: 980 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    proformaNumber: 'PRO-2026-0002',
    divisionId: 'recycling',
    warehouseId: 'b0000000-0000-4000-8000-000000000001',
    customerId: 'cust-002',
    customerName: 'Global Electronics Recyclers',
    customerEmail: 'sales@globalelectronics.ca',
    issueDate: '2026-09-16',
    expiryDate: '2026-10-16',
    status: 'sent',
    subtotal: 840000,
    taxRate: 13,
    taxAmount: 109200,
    total: 949200,
    currency: 'CAD',
    incoterm: 'CIF',
    destination: 'Montreal Container Terminal',
    poReference: 'GER-4412',
    paymentTerms: 'Payment Advance',
    notes: 'Circuit board scrap lots ready for export dispatch.',
    items: [
      { id: 'item-3', description: 'High Grade Circuit Boards', quantity: 1200, unit: 'lbs', unitPrice: 700, total: 840000, tareWeight: 30, netWeight: 1170 }
    ]
  }
];

const MOCK_MATERIALS = [
  { id: 'mat-001', name: 'Bare Bright Copper', code: 'CU-BB', division: 'recycling', category: 'Copper', unit: 'lbs', standardPrice: 450, active: true },
  { id: 'mat-002', name: 'Aluminum Extrusions 6063', code: 'AL-6063', division: 'recycling', category: 'Aluminum', unit: 'lbs', standardPrice: 210, active: true },
  { id: 'mat-003', name: 'Sonic 300 L', code: 'HC-SONIC-300-L', division: 'healthcare', category: 'Gloves', unit: 'box', standardPrice: 1850, active: true },
  { id: 'mat-004', name: 'Sonic 300 M', code: 'HC-SONIC-300-M', division: 'healthcare', category: 'Gloves', unit: 'box', standardPrice: 1850, active: true },
  { id: 'mat-005', name: 'Trasnform 200 L', code: 'HC-TF-200-L', division: 'healthcare', category: 'Gloves', unit: 'box', standardPrice: 2200, active: true }
];

const MOCK_INVENTORY = [
  { id: 'inv-1', materialId: 'mat-001', materialName: 'Bare Bright Copper', code: 'CU-BB', warehouseId: 'b0000000-0000-4000-8000-000000000001', balance: 14500, unit: 'lbs' },
  { id: 'inv-2', materialId: 'mat-002', materialName: 'Aluminum Extrusions 6063', code: 'AL-6063', warehouseId: 'b0000000-0000-4000-8000-000000000001', balance: 8200, unit: 'lbs' },
  { id: 'inv-3', materialId: 'mat-003', materialName: 'Sonic 300 L', code: 'HC-SONIC-300-L', warehouseId: 'b0000000-0000-4000-8000-000000000003', balance: 340, unit: 'box' },
  { id: 'inv-4', materialId: 'mat-004', materialName: 'Sonic 300 M', code: 'HC-SONIC-300-M', warehouseId: 'b0000000-0000-4000-8000-000000000003', balance: 410, unit: 'box' }
];

const MOCK_PHOTOS = [
  { id: 'photo-1', url: '/assets/logo.png', originalFilename: 'copper_bin_scale.jpg', contentType: 'image/jpeg', byteSize: 204800, createdAt: '2026-09-17T12:00:00Z', notes: 'Mississauga scale verification' },
  { id: 'photo-2', url: '/assets/logo.png', originalFilename: 'aluminum_bale_tag.jpg', contentType: 'image/jpeg', byteSize: 182400, createdAt: '2026-09-17T13:30:00Z', notes: 'Tag verification lot #8812' }
];

async function setupPageRoutes(page) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/api/auth/login')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'mock-jwt-token', user: MOCK_USER })
      });
    }

    if (url.includes('/api/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER)
      });
    }

    if (url.includes('/api/warehouses')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WAREHOUSES)
      });
    }

    if (url.includes('/api/divisions')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'recycling', name: 'GreenWave Recycling', code: 'RECYCLING' },
          { id: 'healthcare', name: 'Healthcare Division', code: 'HEALTHCARE' }
        ])
      });
    }

    if (url.includes('/api/proformas')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PROFORMAS)
      });
    }

    if (url.includes('/api/materials')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MATERIALS)
      });
    }

    if (url.includes('/api/inventory/balances') || url.includes('/api/inventory')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_INVENTORY)
      });
    }

    if (url.includes('/api/photos')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PHOTOS)
      });
    }

    if (url.includes('/api/users')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([MOCK_USER])
      });
    }

    if (url.includes('/api/customers')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'cust-001', name: 'Acme Metal Refining Corp', email: 'billing@acmemetal.com' },
          { id: 'cust-002', name: 'Global Electronics Recyclers', email: 'sales@globalelectronics.ca' }
        ])
      });
    }

    if (url.includes('/api/invoices')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }

    if (url.includes('/api/purchase-orders')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }

    // Default fallback
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
}

async function runRegression() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  const results = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n==================================================`);
    console.log(`TESTING VIEWPORT: ${vp.name} (${vp.width}x${vp.height}, isMobile=${vp.isMobile})`);
    console.log(`==================================================`);

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });

    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter benign network errors or extension logs if any
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.message || String(err));
    });

    await setupPageRoutes(page);

    // Navigate to root
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Check Gate screen
    const gateVisible = await page.isVisible('#gate');
    console.log(`  [Gate Screen] Visible: ${gateVisible}`);

    // Fill login form
    await page.fill('#gateEmail', 'admin@greenwave.local');
    await page.fill('#gatePassword', 'Password123!');
    await page.click('#signSubmit');

    // Wait for App shell
    await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const vpResult = {
      viewport: vp.name,
      width: vp.width,
      height: vp.height,
      errors: [],
      viewsTested: [],
      overflows: []
    };

    async function checkView(viewName, navSelector, isSubNav = false) {
      if (navSelector) {
        if (vp.isMobile) {
          const isMenuOpen = await page.evaluate(() => {
            const app = document.getElementById('app');
            return app ? app.classList.contains('menu-open') : false;
          });
          if (!isMenuOpen) {
            await page.click('#menuBtn');
            await page.waitForTimeout(300);
          }
        }
        await page.click(navSelector);
        await page.waitForTimeout(600);
      }

      // Check horizontal overflow
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
        };
      });

      const shotName = `${vp.name}-${viewName}.png`;
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, shotName), fullPage: false });

      console.log(`    -> View [${viewName}]: scrollW=${overflow.scrollWidth}, clientW=${overflow.clientWidth}, overflow=${overflow.hasOverflow} (screenshot: ${shotName})`);

      vpResult.viewsTested.push(viewName);
      if (overflow.hasOverflow) {
        vpResult.overflows.push({ view: viewName, overflow });
      }
    }

    // 1. Dashboard
    await checkView('dashboard', null);

    // 2. Inventory
    await checkView('inventory', '.navitem[data-view="inventory"]');

    // 3. Proformas (Recycling mode)
    await checkView('proformas', '.navitem[data-view="proformas"]');
    // Verify Proforma table rows loaded
    const proformaCount = await page.locator('#proformaList table tbody tr').count();
    console.log(`    [Proforma List] Rendered ${proformaCount} rows`);

    // 4. Invoices
    await checkView('invoices', '.navitem[data-view="invoices"]');

    // 5. Materials / Products
    await checkView('products', '.navitem[data-view="products"]');

    // 6. Staff
    await checkView('staff', '.navitem[data-view="staff"]');

    // 7. Settings
    await checkView('settings', '.navitem[data-view="settings"]');

    async function switchDivision(entity) {
      const topBtn = page.locator(`.top-div-btn[data-entity="${entity}"]`);
      if (await topBtn.isVisible()) {
        await topBtn.click();
        await page.waitForTimeout(600);
        return;
      }
      if (vp.isMobile) {
        const isMenuOpen = await page.evaluate(() => {
          const app = document.getElementById('app');
          return app ? app.classList.contains('menu-open') : false;
        });
        if (!isMenuOpen) {
          await page.click('#menuBtn');
          await page.waitForTimeout(300);
        }
      }
      const railBtn = page.locator(`.entsw button[data-entity="${entity}"]`);
      if (await railBtn.isVisible()) {
        await railBtn.click();
        await page.waitForTimeout(600);
      }
      if (vp.isMobile) {
        const isMenuOpen = await page.evaluate(() => {
          const app = document.getElementById('app');
          return app ? app.classList.contains('menu-open') : false;
        });
        if (isMenuOpen) {
          await page.click('#menuBtn');
          await page.waitForTimeout(300);
        }
      }
    }

    // 8. Test Healthcare Mode Switch
    console.log(`    Testing Healthcare Mode Switch...`);
    await switchDivision('healthcare');

    const entity = await page.evaluate(() => document.documentElement.getAttribute('data-entity'));
    console.log(`    [Entity Switch] Current data-entity: ${entity}`);

    // Verify proformas nav item is hidden in healthcare mode
    const proformasNavVisible = await page.evaluate(() => {
      const btn = document.querySelector('.navitem[data-view="proformas"]');
      return btn ? (btn.offsetWidth > 0 && btn.offsetHeight > 0 && !btn.hidden) : false;
    });
    console.log(`    [RBAC/Division Check] Proformas nav visible in healthcare mode: ${proformasNavVisible} (Expected: false)`);

    await checkView('healthcare-dashboard', null);
    await checkView('healthcare-inventory', '.navitem[data-view="inventory"]');

    // Switch back to recycling
    await switchDivision('recycling');

    vpResult.errors = [...consoleErrors, ...pageErrors];
    results.push(vpResult);

    await context.close();
  }

  await browser.close();
  server.close();

  console.log(`\n==================================================`);
  console.log(`REGRESSION TEST SUMMARY:`);
  console.log(`==================================================`);
  let allPass = true;
  for (const r of results) {
    const errorCount = r.errors.length;
    const overflowCount = r.overflows.length;
    const pass = errorCount === 0 && overflowCount === 0;
    if (!pass) allPass = false;
    console.log(`Viewport: ${r.viewport} (${r.width}x${r.height}) | Views: ${r.viewsTested.length} | Errors: ${errorCount} | Overflows: ${overflowCount} -> ${pass ? 'PASS' : 'FAIL'}`);
    if (r.errors.length > 0) {
      console.log(`  Console/Page Errors:`, r.errors);
    }
    if (r.overflows.length > 0) {
      console.log(`  Overflows:`, r.overflows);
    }
  }

  if (allPass) {
    console.log(`\nALL VIEWPORTS PASSED WITH ZERO CONSOLE ERRORS AND ZERO HORIZONTAL OVERFLOW!`);
  } else {
    console.error(`\nSOME CHECKS FAILED.`);
    process.exit(1);
  }
}

runRegression().catch((err) => {
  console.error('FATAL REGRESSION RUNNER ERROR:', err);
  process.exit(1);
});
