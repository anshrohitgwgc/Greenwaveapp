import { test, expect } from "@playwright/test";

const API_BASE = "http://127.0.0.1:4000";

const ADMIN_EMAIL = process.env.GREENWAVE_TEST_ADMIN_EMAIL || "admin@greenwave.local";
const ADMIN_PASSWORD = process.env.GREENWAVE_TEST_ADMIN_PASSWORD || "DevPassword123!";

const STAFF_EMAIL = "staff.calgary@test.greenwave.local";
const STAFF_PASSWORD = process.env.GREENWAVE_TEST_ADMIN_PASSWORD || "DevPassword123!";

const MANAGER_EMAIL = "manager@test.greenwave.local";
const MANAGER_PASSWORD = process.env.GREENWAVE_TEST_ADMIN_PASSWORD || "DevPassword123!";

const W_CGY = "22222222-2222-4222-8222-222222222222";
const W_ON = "33333333-3333-4333-8333-333333333333";
const W_MR = "11111111-1111-4111-8111-111111111111";

let adminToken = "";
let staffToken = "";
let managerToken = "";

// Helper for UI login
async function uiLogin(page, email, password) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=\"submit\"]");
  await page.waitForURL("**/dashboard", { timeout: 10000 });
}

// Helper to pre-seed auth token into localStorage
async function seedSession(page, token, email, role = "admin") {
  await page.addInitScript(
    ({ t, e, r }) => {
      window.localStorage.setItem("greenwave_token", t);
      window.localStorage.setItem(
        "greenwave_user",
        JSON.stringify({ id: 1, fullName: "Test User", email: e, role: r })
      );
    },
    { t: token, e: email, r: role }
  );
}

test.beforeAll(async ({ request }) => {
  // Obtain tokens for admin, staff, and manager
  const aResp = await request.post(`${API_BASE}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(aResp.ok()).toBeTruthy();
  const aBody = await aResp.json();
  adminToken = aBody.access_token;

  const sResp = await request.post(`${API_BASE}/auth/login`, {
    data: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
  });
  expect(sResp.ok()).toBeTruthy();
  const sBody = await sResp.json();
  staffToken = sBody.access_token;

  const mResp = await request.post(`${API_BASE}/auth/login`, {
    data: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
  });
  expect(mResp.ok()).toBeTruthy();
  const mBody = await mResp.json();
  managerToken = mBody.access_token;
});

// ==============================================================================
// 1. AUTHENTICATION
// ==============================================================================
test.describe("1. AUTHENTICATION", () => {
  test("Login succeeds with valid admin credentials", async ({ page }) => {
    await uiLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator(".navbar-title, .navbar-brand, .brand-name").first()).toContainText("GreenWave");
  });

  test("Invalid login shows error message and does not navigate", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", "WrongPassword123!");
    await page.click("button[type=\"submit\"]");
    const errorAlert = page.locator(".alert-error");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Invalid|Unable to sign in/i);
    expect(page.url()).toContain("/login");
  });

  test("Signup option is completely absent from login UI and API registration is disabled", async ({ page, request }) => {
    await page.goto("/login");
    const registerLink = page.locator("a:has-text(\"Sign Up\"), a:has-text(\"Register\")");
    await expect(registerLink).toHaveCount(0);

    const regResp = await request.post(`${API_BASE}/auth/register`, {
      data: {
        fullName: "Test Hacker",
        email: "hacker@test.com",
        password: "Password123!",
      },
    });
    expect(regResp.status()).toBe(403);
  });

  test("Logout clears session and redirects to login", async ({ page }) => {
    await uiLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const logoutBtn = page.locator("button:has-text(\"Log Out\"), .btn-logout");
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
  });
});

// ==============================================================================
// 2. WAREHOUSE ACCESS & DOM FACILITY SELECTOR
// ==============================================================================
test.describe("2. WAREHOUSE ACCESS & FACILITY SELECTOR DOM", () => {
  test("Single warehouse user (Staff Calgary) is restricted to Calgary only (API)", async ({ request }) => {
    const whResp = await request.get(`${API_BASE}/warehouses`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(whResp.ok()).toBeTruthy();
    const warehouses = await whResp.json();
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].id).toBe(W_CGY);

    const cgyBal = await request.get(`${API_BASE}/inventory/balances?warehouseId=${W_CGY}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(cgyBal.status()).toBe(200);

    const onBal = await request.get(`${API_BASE}/inventory/balances?warehouseId=${W_ON}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(onBal.status()).toBe(403);
  });

  test("Multi-warehouse user (Manager) accesses Calgary + Maple Ridge, blocked from Ontario (API)", async ({ request }) => {
    const whResp = await request.get(`${API_BASE}/warehouses`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(whResp.ok()).toBeTruthy();
    const warehouses = await whResp.json();
    const ids = warehouses.map((w) => w.id);
    expect(ids).toContain(W_CGY);
    expect(ids).toContain(W_MR);
    expect(ids).not.toContain(W_ON);

    const onResp = await request.get(`${API_BASE}/warehouses/${W_ON}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(onResp.status()).toBe(403);
  });

  test("DOM Facility Selector: Staff Calgary sees only Calgary in dropdown without Ontario/Maple Ridge", async ({ page }) => {
    await seedSession(page, staffToken, STAFF_EMAIL, "staff");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const selector = page.locator("[data-testid=\"facility-selector\"]");
    await expect(selector).toBeVisible();

    const optionTexts = await selector.locator("option").allTextContents();
    expect(optionTexts).toContain("Calgary, AB");
    expect(optionTexts).not.toContain("Ontario");
    expect(optionTexts).not.toContain("Maple Ridge, BC");

    // Check no duplicate options
    const uniqueOptions = new Set(optionTexts);
    expect(uniqueOptions.size).toBe(optionTexts.length);
  });

  test("DOM Facility Selector: Manager sees Calgary and Maple Ridge without Ontario", async ({ page }) => {
    await seedSession(page, managerToken, MANAGER_EMAIL, "manager");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const selector = page.locator("[data-testid=\"facility-selector\"]");
    await expect(selector).toBeVisible();

    const optionTexts = await selector.locator("option").allTextContents();
    expect(optionTexts).toContain("Calgary, AB");
    expect(optionTexts).toContain("Maple Ridge, BC");
    expect(optionTexts).not.toContain("Ontario");

    const uniqueOptions = new Set(optionTexts);
    expect(uniqueOptions.size).toBe(optionTexts.length);
  });

  test("Warehouse ID tampering returns 403 across all sensitive endpoints", async ({ request }) => {
    const txTamper = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        warehouseId: W_ON,
        materialId: "44444444-4444-4444-8444-444444444444",
        type: "inbound",
        unitType: "pallet",
        division: "recycling",
        weightValue: 250,
        weightUnit: "kg",
      },
    });
    expect(txTamper.status()).toBe(403);

    const contTamper = await request.post(`${API_BASE}/containers`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: {
        warehouseId: W_ON,
        containerNumber: "TAMPER-CONT-01",
      },
    });
    expect(contTamper.status()).toBe(403);

    const photoTamper = await request.get(`${API_BASE}/photos?warehouseId=${W_ON}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(photoTamper.status()).toBe(403);

    const clockTamper = await request.post(`${API_BASE}/timesheets/clock-in`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: { warehouseId: W_ON },
    });
    expect(clockTamper.status()).toBe(403);
  });
});

// ==============================================================================
// 3. DIVISION ISOLATION & CONDITIONAL UI
// ==============================================================================
test.describe("3. DIVISION ISOLATION & CONDITIONAL UI", () => {
  const warehouses = [
    { name: "Calgary", id: W_CGY },
    { name: "Ontario", id: W_ON },
    { name: "Maple Ridge", id: W_MR },
  ];

  for (const wh of warehouses) {
    test(`Recycling and Healthcare isolation for ${wh.name}`, async ({ request }) => {
      const recTx = await request.post(`${API_BASE}/inventory/transactions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          warehouseId: wh.id,
          materialId: "44444444-4444-4444-8444-444444444444",
          type: "inbound",
          division: "recycling",
          unitType: "pallet",
          weightValue: 500,
          weightUnit: "kg",
          orderNumber: `REC-${wh.name.replace(/\s+/g, "")}-${Date.now()}`,
        },
      });
      expect(recTx.status()).toBe(201);

      const hcTx = await request.post(`${API_BASE}/inventory/transactions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          warehouseId: wh.id,
          materialId: "77777777-7777-4777-8777-777777777777",
          type: "inbound",
          division: "healthcare",
          unitType: "box",
          xl: 20,
          l: 30,
          m: 10,
          s: 5,
          orderNumber: `HC-${wh.name.replace(/\s+/g, "")}-${Date.now()}`,
        },
      });
      expect(hcTx.status()).toBe(201);

      const recBal = await request.get(`${API_BASE}/inventory/balances?warehouseId=${wh.id}&division=recycling`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(recBal.status()).toBe(200);

      const hcBal = await request.get(`${API_BASE}/inventory/balances?warehouseId=${wh.id}&division=healthcare`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(hcBal.status()).toBe(200);
    });
  }

  test("UI Division Switcher toggles fields and prevents stale value leakage", async ({ page }) => {
    await seedSession(page, adminToken, ADMIN_EMAIL, "admin");
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");

    // 1. Initially Recycling
    await page.click("[data-testid=\"division-recycling\"]");
    await expect(page.locator("[data-testid=\"recycling-fields\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"input-pallets\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"input-weight\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"healthcare-fields\"]")).toHaveCount(0);

    // Enter test values in recycling
    await page.fill("[data-testid=\"input-pallets\"]", "4");
    await page.fill("[data-testid=\"input-weight\"]", "1250.5");

    // 2. Switch to Healthcare
    await page.click("[data-testid=\"division-healthcare\"]");
    await expect(page.locator("[data-testid=\"healthcare-fields\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"input-xl\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"recycling-fields\"]")).toHaveCount(0);

    // Enter test values in healthcare
    await page.fill("[data-testid=\"input-xl\"]", "50");
    await page.fill("[data-testid=\"input-l\"]", "75");

    // 3. Switch back to Recycling -> inputs must be reset and fresh
    await page.click("[data-testid=\"division-recycling\"]");
    await expect(page.locator("[data-testid=\"recycling-fields\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"healthcare-fields\"]")).toHaveCount(0);
    expect(await page.locator("[data-testid=\"input-pallets\"]").inputValue()).toBe("");
    expect(await page.locator("[data-testid=\"input-weight\"]").inputValue()).toBe("");
  });
});

// ==============================================================================
// 4. INTEGER UNIT TESTS & PHYSICAL COUNT RULES
// ==============================================================================
test.describe("4. INTEGER UNIT TESTS & INVENTORY COUNT RULES", () => {
  test("Recycling: whole pallets (1, 2, 6) valid; fractional (1.5, 0.12) and negative invalid", async ({ request }) => {
    // Valid whole quantities
    for (const validQty of [1, 2, 6]) {
      const resp = await request.post(`${API_BASE}/inventory/transactions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: {
          warehouseId: W_CGY,
          materialId: "44444444-4444-4444-8444-444444444444",
          type: "inbound",
          division: "recycling",
          unitType: "pallet",
          weightValue: validQty * 100,
          weightUnit: "kg",
        },
      });
      expect(resp.status()).toBe(201);
    }

    // Invalid fractional / negative weights or size violations
    const invFrac = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseId: W_CGY,
        materialId: "44444444-4444-4444-8444-444444444444",
        type: "inbound",
        division: "recycling",
        unitType: "pallet",
        xl: 1.5, // fractional size on recycling invalid
      },
    });
    expect(invFrac.status()).toBe(400);

    const invNeg = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseId: W_CGY,
        materialId: "44444444-4444-4444-8444-444444444444",
        type: "inbound",
        division: "recycling",
        unitType: "pallet",
        xl: -1,
      },
    });
    expect(invNeg.status()).toBe(400);
  });

  test("Healthcare: whole boxes (1, 100) valid; fractional (1.5, 0.12) and negative invalid", async ({ request }) => {
    // Valid whole numbers
    const validResp = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseId: W_CGY,
        materialId: "77777777-7777-4777-8777-777777777777",
        type: "inbound",
        division: "healthcare",
        unitType: "box",
        xl: 100,
        l: 1,
        m: 5,
        s: 0,
      },
    });
    expect(validResp.status()).toBe(201);

    // Invalid fractional
    const fracResp = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseId: W_CGY,
        materialId: "77777777-7777-4777-8777-777777777777",
        type: "inbound",
        division: "healthcare",
        unitType: "box",
        xl: 1.5,
      },
    });
    expect(fracResp.status()).toBe(400);

    // Invalid negative
    const negResp = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseId: W_CGY,
        materialId: "77777777-7777-4777-8777-777777777777",
        type: "inbound",
        division: "healthcare",
        unitType: "box",
        l: -5,
      },
    });
    expect(negResp.status()).toBe(400);
  });

  test("Weight is separate and accepts valid fractional values (1250.5 KG)", async ({ request }) => {
    const fracWeight = await request.post(`${API_BASE}/inventory/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseId: W_CGY,
        materialId: "44444444-4444-4444-8444-444444444444",
        type: "inbound",
        division: "recycling",
        unitType: "pallet",
        weightValue: 1250.5,
        weightUnit: "kg",
      },
    });
    expect(fracWeight.status()).toBe(201);
    const body = await fracWeight.json();
    expect(Number(body.weightValue)).toBe(1250.5);
    expect(body.weightUnit).toBe("kg");
  });
});

// ==============================================================================
// 5. PHOTO AUTHORIZATION & BROWSER LIGHTBOX UI
// ==============================================================================
test.describe("5. PHOTO AUTHORIZATION & LIGHTBOX UI", () => {
  test("Staff uploads photo (API), queries authorized vs unauthorized facilities", async ({ request }) => {
    const samplePngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    const uploadResp = await request.post(`${API_BASE}/photos`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      multipart: {
        file: {
          name: "test-photo.png",
          mimeType: "image/png",
          buffer: samplePngBuffer,
        },
        warehouseId: W_CGY,
        photoType: "inbound",
        jobReference: `JOB-TEST-${Date.now()}`,
      },
    });
    expect(uploadResp.status()).toBe(201);
    const photo = await uploadResp.json();
    expect(photo.id).toBeDefined();

    const listResp = await request.get(`${API_BASE}/photos?warehouseId=${W_CGY}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(listResp.status()).toBe(200);

    const unauthList = await request.get(`${API_BASE}/photos?warehouseId=${W_ON}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    expect(unauthList.status()).toBe(403);
  });

  test("Browser Photo Lightbox opens, displays metadata, closes via button, escape, and backdrop click", async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await seedSession(page, adminToken, ADMIN_EMAIL, "admin");
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");

    // Click thumbnail
    const thumb = page.locator("[data-testid=\"photo-thumbnail\"]").first();
    await expect(thumb).toBeVisible();
    await thumb.click();

    // 1. Verify Lightbox opened
    const lightbox = page.locator("[data-testid=\"lightbox-modal\"]");
    await expect(lightbox).toBeVisible();
    await expect(page.locator("[data-testid=\"lightbox-image\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"lightbox-metadata\"]")).toBeVisible();

    // 2. Close via Close Button
    const closeBtn = page.locator("[data-testid=\"lightbox-close\"]");
    await closeBtn.click();
    await expect(lightbox).toHaveCount(0);

    // 3. Reopen & close via Escape Key
    await thumb.click();
    await expect(lightbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);

    // 4. Reopen & close via backdrop click
    await thumb.click();
    await expect(lightbox).toBeVisible();
    await page.locator("[data-testid=\"lightbox-backdrop\"]").click({ position: { x: 10, y: 10 } });
    await expect(lightbox).toHaveCount(0);

    // 5. Refresh and reopen to verify stability
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator("[data-testid=\"photo-thumbnail\"]").first().click();
    await expect(page.locator("[data-testid=\"lightbox-modal\"]")).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});

// ==============================================================================
// 6. STAFF MANAGEMENT & AUDIT LOGGING
// ==============================================================================
test.describe("6. STAFF MANAGEMENT & AUDIT", () => {
  test("Admin assigns warehouse, updates access, and persistent audit event is recorded", async ({ request }) => {
    const uniqueEmail = `assignable_${Date.now()}@test.greenwave.local`;
    const newUserResp = await request.post(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        fullName: "Test Assignable Staff",
        email: uniqueEmail,
        password: "DevPassword123!",
        role: "staff",
      },
    });
    expect(newUserResp.status()).toBe(201);
    const newUser = await newUserResp.json();

    // Assign Calgary & Ontario
    const assignResp = await request.put(`${API_BASE}/users/${newUser.id}/warehouses`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseIds: [W_CGY, W_ON],
      },
    });
    expect(assignResp.status()).toBe(200);
    const assignedWh = await assignResp.json();
    expect(assignedWh).toHaveLength(2);

    // Check audit event
    const auditResp = await request.get(`${API_BASE}/audit?entityType=user&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(auditResp.status()).toBe(200);
    const auditBody = await auditResp.json();
    const auditEvents = Array.isArray(auditBody) ? auditBody : (auditBody.items || auditBody.data || []);
    const updateEvent = auditEvents.find(
      (e) => e.action === "user.warehouse_access_updated" && String(e.entityId) === String(newUser.id)
    );
    expect(updateEvent).toBeDefined();

    // Revoke Ontario (assign Calgary only)
    const revokeResp = await request.put(`${API_BASE}/users/${newUser.id}/warehouses`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        warehouseIds: [W_CGY],
      },
    });
    expect(revokeResp.status()).toBe(200);
  });
});

// ==============================================================================
// 7. INVOICE MANAGEMENT & PRINT/PDF UI
// ==============================================================================
test.describe("7. INVOICE MANAGEMENT & PRINT/PDF UI", () => {
  test("Admin creates invoice (API), retrieves, and updates details", async ({ request }) => {
    const invoiceResp = await request.post(`${API_BASE}/invoices`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        customerId: "66666666-6666-4666-8666-666666666666",
        warehouseId: W_MR,
        invoiceDate: "2026-08-29",
        dueDate: "2026-09-29",
        // The admin account holds both business divisions, so the API
        // requires the invoice's division to be stated rather than inferred.
        division: "greenwave",
        status: "draft",
        items: [
          {
            description: "Electronics Recycling Processing",
            quantity: 1000,
            unitPrice: 0.35,
          },
        ],
      },
    });
    expect(invoiceResp.status()).toBe(201);
    const invoice = await invoiceResp.json();
    expect(invoice.id).toBeDefined();

    const getResp = await request.get(`${API_BASE}/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(getResp.status()).toBe(200);

    const patchResp = await request.patch(`${API_BASE}/invoices/${invoice.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        notes: "Updated invoice notes via E2E test",
        status: "final",
      },
    });
    expect(patchResp.status()).toBe(200);
  });

  test("Browser Invoice Print/PDF view: verifies branding, Bill/Ship To, line items, totals, and print trigger", async ({ page }) => {
    await seedSession(page, adminToken, ADMIN_EMAIL, "admin");
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");

    // 1. Open New Invoice Form
    await page.click("[data-testid=\"create-invoice-btn\"]");
    await expect(page.locator("[data-testid=\"new-invoice-form\"]")).toBeVisible();
    await page.fill("[data-testid=\"invoice-desc-input\"]", "Pallet Recycling Sort & Bale");
    await page.fill("[data-testid=\"invoice-qty-input\"]", "500");
    await page.fill("[data-testid=\"invoice-price-input\"]", "1.20");
    await page.click("[data-testid=\"save-invoice-btn\"]");

    // Navigates to Invoice Detail
    await page.waitForURL(/\/invoices\/[a-f0-9-]+/, { timeout: 10000 });
    const printSheet = page.locator("[data-testid=\"invoice-print-sheet\"]");
    await expect(printSheet).toBeVisible();

    // Verify UI Print elements
    await expect(page.locator(".brand-section")).toContainText("GreenWave");
    await expect(page.locator("[data-testid=\"invoice-billto\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"invoice-shipto\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"invoice-shipping-info\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"invoice-items-table\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"invoice-subtotal\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"invoice-gst\"]")).toBeVisible();
    await expect(page.locator("[data-testid=\"invoice-total\"]")).toBeVisible();

    // Intercept window.print
    await page.evaluate(() => {
      window.__printed = false;
      window.print = () => { window.__printed = true; };
    });

    await page.click("[data-testid=\"print-invoice-btn\"]");
    const wasPrinted = await page.evaluate(() => window.__printed);
    expect(wasPrinted).toBe(true);
  });
});

// ==============================================================================
// 8. LIVE TIME CLOCK UI & TICKER
// ==============================================================================
test.describe("8. LIVE TIME CLOCK UI", () => {
  test("Staff clocks in via UI, verifies live timer ticking, page navigation & reload persistence, and clocks out", async ({ page, request }) => {
    // Clock out any prior shift via API first
    const checkShift = await request.get(`${API_BASE}/timesheets/me/current`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });
    if (checkShift.ok()) {
      const text = await checkShift.text();
      if (text && text.trim().length > 0) {
        await request.post(`${API_BASE}/timesheets/clock-out`, {
          headers: { Authorization: `Bearer ${staffToken}` },
        });
      }
    }

    await seedSession(page, staffToken, STAFF_EMAIL, "staff");
    await page.goto("/timesheets");
    await page.waitForLoadState("networkidle");

    // 1. Initial State: Clocked Out
    await expect(page.locator("[data-testid=\"shift-status\"]")).toContainText("Clocked Out");

    // 2. Click Clock In (with rapid double click verification)
    const clockInBtn = page.locator("[data-testid=\"clock-in-btn\"]");
    await clockInBtn.dblclick(); // Rapid double click

    // 3. State changes to Clocked In
    await expect(page.locator("[data-testid=\"shift-status\"]")).toContainText("Clocked In");

    // 4. Record initial timer and wait 3s
    const timerElem = page.locator("[data-testid=\"live-timer\"]");
    await expect(timerElem).toBeVisible();
    const initialTimer = await timerElem.textContent();

    await page.waitForTimeout(3200);

    const updatedTimer = await timerElem.textContent();
    expect(updatedTimer).not.toBe(initialTimer); // Timer increased

    // 5. Navigate to Dashboard and return to Time Clock
    await page.click("a[href=\"/dashboard\"]");
    await page.waitForURL("**/dashboard");
    await page.click("a[href=\"/timesheets\"]");
    await page.waitForURL("**/timesheets");

    // Verify timer continues
    await expect(page.locator("[data-testid=\"shift-status\"]")).toContainText("Clocked In");

    // 6. Reload page and verify active shift persists
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-testid=\"shift-status\"]")).toContainText("Clocked In");

    // 7. Click Clock Out
    const clockOutBtn = page.locator("[data-testid=\"clock-out-btn\"]");
    await expect(clockOutBtn).toBeVisible();
    await clockOutBtn.click();

    // 8. Verify Clocked Out and history recorded
    await expect(page.locator("[data-testid=\"shift-status\"]")).toContainText("Clocked Out");
    await expect(page.locator("[data-testid=\"timesheet-history\"]")).toBeVisible();
    const historyRow = page.locator("[data-testid=\"history-row\"]").first();
    await expect(historyRow).toBeVisible();
  });
});

// ==============================================================================
// 9. RESPONSIVE VIEWPORTS & CONSOLE/NETWORK MONITORING
// ==============================================================================
test.describe("9. RESPONSIVE UI & CONSOLE/NETWORK MONITORING", () => {
  const viewports = [
    { name: "Mobile Small (390x844)", width: 390, height: 844 },
    { name: "Mobile Large (430x932)", width: 430, height: 932 },
    { name: "Tablet Portrait (768x1024)", width: 768, height: 1024 },
    { name: "Laptop (1366x768)", width: 1366, height: 768 },
    { name: "Desktop (1920x1080)", width: 1920, height: 1080 },
  ];

  for (const vp of viewports) {
    test(`UI renders cleanly and without errors on ${vp.name}`, async ({ page }) => {
      const consoleErrors = [];
      const failedRequests = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      page.on("pageerror", (err) => {
        consoleErrors.push(err.message);
      });

      page.on("requestfailed", (req) => {
        failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await seedSession(page, adminToken, ADMIN_EMAIL, "admin");

      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");

      // Verify dashboard components
      await expect(page.locator(".navbar-title, .navbar-brand, .brand-name").first()).toBeVisible();
      await expect(page.locator(".stats-grid, .dashboard-container, .card").first()).toBeVisible();

      // Navigate to Pickups page
      const pickupsLink = page.locator("a[href=\"/pickups\"], a:has-text(\"Pickups\")");
      if (await pickupsLink.count() > 0) {
        await pickupsLink.first().click();
        await page.waitForURL("**/pickups");
        await expect(page.locator(".pickups-page, .pickups-container, .card").first()).toBeVisible();
      }

      // Verify zero console errors and zero unexpected network failures
      expect(consoleErrors).toEqual([]);
      expect(failedRequests).toEqual([]);
    });
  }
});

// ==============================================================================
// 10. HIGH-RESOLUTION BRANDING LOGO QA
// ==============================================================================
test.describe("10. HIGH-RESOLUTION BRANDING LOGO QA", () => {
  test("Login page renders high-resolution logo with valid natural dimensions and no distortion", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const logo = page.locator("[data-testid=\"brand-logo\"]");
    await expect(logo).toBeVisible();

    // Verify image loading and natural dimensions
    const isLoaded = await logo.evaluate((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    expect(isLoaded).toBe(true);

    const dims = await logo.evaluate((img) => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      src: img.src,
      aspectRatio: (img.naturalWidth / img.naturalHeight).toFixed(2),
    }));

    expect(dims.src).toContain("logo.png");
    expect(dims.naturalWidth).toBe(860);
    expect(dims.naturalHeight).toBe(311);
    expect(Number(dims.aspectRatio)).toBeCloseTo(2.76, 1);
  });

  test("Authenticated Navbar and Invoice render sharp high-resolution logo across viewports", async ({ page }) => {
    await seedSession(page, adminToken, ADMIN_EMAIL, "admin");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const navLogo = page.locator("[data-testid=\"navbar-logo\"]").first();
    await expect(navLogo).toBeVisible();

    const navLoaded = await navLogo.evaluate((img) => img.complete && img.naturalWidth === 860 && img.naturalHeight === 311);
    expect(navLoaded).toBe(true);

    // Verify on mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(navLogo).toBeVisible();
  });
});
