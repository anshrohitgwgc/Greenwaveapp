# GreenWave V2 — Final Pre-Merge QA Report

**Branch:** `greenwave-payment-rbac-ui`
**Production baseline:** `25f3d57f935b558ebe74af2112ba320a99018a06` (confirmed live at `gwgc.cloud`, read-only check — see `FRONTEND_ARCHITECTURE_DECISION.md`)
**Source commit (session start):** `315d29f9cd3eaf139bc4fc9f5895ba6505086a3a`
**Final commit (this session):** see `git log -1` after the commits listed in §22 — this branch, not merged, not pushed
**Environment:** 100% local (local Postgres `greenwave_dev`, local Redis, local MinIO `greenwave-local-minio`, local NestJS API on `:4000`, static frontend on `:8080`)
**Production status:** **NOT DEPLOYED.** No production host, database, cache, object store, or portal was touched this session.

---

## 1. QA process handling

A Playwright run of `responsive-visual-qa.spec.js` (started earlier this session, PID 238884) was found still in progress at the start of this pass. Per instructions, no duplicate run was started — its actual completion (`9 failed, 16 passed (7.2m)`) was captured from its process output before any further action. Those 9 failures were investigated and root-caused (§8) before any fix was written.

---

## 2. Failure classification and fixes

| # | Symptom | Class | Root cause | Action |
|---|---|---|---|---|
| 1 | 9 responsive tests: `.navitem` click times out ("element outside viewport") at 390/430/768px widths, on Dashboard/Invoices/Staff | **C — Application bug** | `assets/app.js` toggles `menu-open` on `#app`; `assets/app.css`'s mobile media block only defined `.rail.open` — no rule ever connected `#app.menu-open` to the rail's slide-in transform. Regression from commit `003878d8` (2026-08-28), which replaced the working `.app.menu-open .rail { transform: none }` + backdrop rule with `.rail.open` but never updated the toggle target in JS. The hamburger button had been visually inert on every mobile/tablet width since that commit. | Fixed in `assets/app.css`: restored `.app.menu-open .rail { transform: translateX(0) }` (kept `.rail.open` too) and the dimming backdrop, matching the pre-regression behavior exactly. No JS change needed. |
| 2 | `global-chat.spec.js` "sending an empty message is a no-op": expected 0 new messages, got 11 | **A — Test bug** | The static markup has `<div class="chat-empty">Loading messages…</div>` inside `#chatMessagesList` before the initial `GET /chat/messages` resolves. The test's `waitForSelector('.chat-msg, .chat-empty')` matched that loading placeholder itself (both share `.chat-empty`), so the "before" count was taken at 0 while the real list (11 pre-existing messages from earlier QA runs) was still loading; it landed within the test's 500ms wait window, producing a false "11 new" reading. Client-side send logic (`text.trim(); if (!text) return;` in `assets/app.js`) was verified correct by code review — whitespace-only input never reaches the API. | Fixed the test to `waitForFunction` on the "Loading messages…" text being gone before sampling the baseline count. Reran in isolation: 3/3 pass. No application code changed for this item. |

No other test failures occurred in this pass (see §17 for full suite results).

---

## 3. Customer email bug

**Status: PASS** (fixed earlier this session, commit `a978c5e`, reverified this pass)

- Root cause: `class-validator`'s `@IsOptional()` only skips validation for `null`/`undefined`, not `''`. The Add Customer form sends `email: ''` when left blank (no `required` attribute), so `@IsEmail()` ran against an empty string and every email-blank submission failed `400`.
- Fix: `CreateCustomerDto`/`UpdateCustomerDto` now transform `''` → `undefined` for `email` and `warehouseId` before validation.
- Verified via real flow, not just unit test:
  - Email populated → `201`, stored correctly.
  - Email blank → `201`, `email` stored as `null` (was `400` before the fix).
  - Invalid email (e.g. `not-an-email`) → still a real `400` validation error — validation was **not** weakened, only the blank/absent case was fixed.
- Covered by `backend/app/api/src/customers/dto/create-customer.dto.spec.ts` and `tests/e2e-legacy/specs/customers.spec.js` (browser-level "create works" test), both passing.

---

## 4–5. Inbound / Outbound browser E2E

**Status: PASS** — `tests/e2e-legacy/specs/inventory-inbound-outbound.spec.js`, run against the canonical repo-root vanilla-JS frontend in a real Chromium browser.

- **Recycling inbound:** Order/PO, Product, Pallet Quantity, Weight, KG/LB, Container, Seal, Photo, Notes entered; verified **Total = pallet quantity**; verified no XL/L/M/S fields present; submitted; persisted record confirmed via reload.
- **Healthcare inbound:** Order/PO, Product, XL, L, M, S, Container, Seal, Photo, Notes entered; verified **Total = XL+L+M+S**; verified no Weight/KG/LB fields present; submitted; persisted record confirmed.
- **Outbound:** Recycling (pallets+weight) and Healthcare (boxes/XL-L-M-S) both ship correctly, reduce inventory balances, and record container data.
- **Warehouse isolation:** a Calgary inbound transaction does not change Ontario stock for the same material (dedicated test case).

---

## 6. Global Chat browser E2E

**Status: PASS** — `tests/e2e-legacy/specs/global-chat.spec.js`, two real browser contexts.

- Context A sends a message → appears with correct sender, message text, and non-empty timestamp.
- Context B (already connected, separate login as `manager@greenwave.local`) receives it **without a reload**, verified against the live `EventSource`/SSE response to `/chat/stream` (not the 4s polling fallback — the assertion timeout is tighter than the poll interval).
- Reload → message persists (server-side, not memory-only).
- Empty/whitespace-only send is a genuine no-op (§2, item 2).
- No console errors observed during the run (Playwright run had 0 unhandled page errors across the suite — see §17).

---

## 7. Customers browser E2E

**Status: PASS** — `tests/e2e-legacy/specs/customers.spec.js`.

- List renders, create works, new customer persists after reload.
- A customer added to one facility does not appear when scoped to a different facility.
- Staff role cannot access the Customers view at all (RBAC gate at the UI layer, backed by server-side authorization).
- Blank optional email: covered by §3.

---

## 8. Responsive QA

**Status: PASS (after fix)** — `tests/e2e-legacy/specs/responsive-visual-qa.spec.js`, all 5 viewports (390×844, 430×932, 768×1024, 1366×768, 1920×1080) × 5 screens (Login, Dashboard/Inventory, Invoices, Staff, Customer payment page) = 25 tests, plus the pre-existing `test-warehouse-and-division-isolation.spec.js` §9 responsive block (5 more viewport checks with console/network monitoring) — **all 30 green**.

- Narrow-width navigation goes through the real `#menuBtn` hamburger (see helper `goToNav`), not an assumed-visible desktop nav.
- No horizontal overflow at any tested width (`document.documentElement.scrollWidth <= viewportWidth + 2px`, enforced per-screen).
- No clipped controls, broken forms, or broken tables observed in the screenshot pass (`test-results/responsive-visual-qa/*.png`).
- The one real defect this section surfaced — the hamburger menu being visually non-functional — is fixed and documented in §2, item 1.

---

## 9. Server-side photo EXIF/GPS security

**Status: PASS** (fixed earlier this session, commit `0077ada`; independently reverified this pass with a live round-trip)

- `PhotosService.upload` re-encodes every uploaded image through `sharp` (auto-applying EXIF orientation first, then dropping EXIF/GPS/camera metadata by default) before the bytes reach MinIO. Also rejects files that don't actually decode as images, regardless of declared mimetype.
- Reverified this pass by running `backend/app/api/test/photo-exif-security.e2e-spec.ts` directly (it is **not** wired into the root `npm run test:e2e` script — run explicitly via `npx jest --config ./test/jest-e2e.json photo-exif-security`, 3/3 passed):
  - Uploads a real JPEG with embedded GPS + camera EXIF through the live `/photos` API.
  - Reads the object back from the **real local MinIO container** (not a mock).
  - Asserts GPS/camera metadata is gone and the image still decodes correctly.
  - Also asserts unauthorized-warehouse upload rejection and spoofed-mimetype rejection.
- Sanitization happens server-side; nothing about this depends on the frontend also stripping metadata.

---

## 10. Payment

**STRIPE LIVE ROUND-TRIP: BLOCKED — STRIPE ACCOUNT SETUP PENDING**
No `STRIPE_*` environment variables are configured in `backend/app/api/.env` or `backend/.env`, and no live/test Stripe SDK integration exists in `payments.service.ts` — the checkout/session flow is a local, self-contained simulation (server-generated token + session id), not a real call to Stripe's API. No Stripe checkout PASS is claimed.

Provider-independent logic — **PASS**, verified via `backend/tests/security/payment-security.test.ts` (part of the 19/19 `test:security` pass) and `backend/tests/unit/payments.test.ts`:

| Item | Status |
|---|---|
| Payment token (256-bit hex, unpredictable) | PASS |
| Amount integrity (server-authoritative from the DB invoice, tamper attempts rejected) | PASS |
| Currency integrity (no silent conversion) | PASS |
| Webhook signature (HMAC-SHA256, forged/invalid signatures rejected) | PASS |
| Webhook replay defense (timestamp freshness, stale requests rejected) | PASS |
| Webhook idempotency (duplicate delivery does not double-apply) | PASS |
| Payment failure handling (`payment_intent.payment_failed` → invoice stays unpaid) | PASS |
| Refund authorization (admin succeeds, non-admin `403`) | PASS |
| Payment state transitions (`UNPAID → PENDING → PAID → REFUNDED`/`FAILED`, invalid transitions rejected) | PASS |

---

## 11. Management RBAC

**Status: PASS** — `backend/tests/security/warehouse-authorization-matrix.test.ts` and `security-audit.test.ts` (part of the 19/19 `test:security` pass), plus `test-warehouse-and-division-isolation.spec.js` browser coverage.

- Roles (Admin/Manager/Staff/Driver) verified independent from warehouse assignment.
- Single-facility, multi-facility, and all-facilities (global access) assignment scenarios all covered.
- Self-promotion, unauthorized warehouse self-assignment, unauthorized global-access grant, and privileged-user deactivation attempts all rejected with `403`.
- Direct API warehouse-ID tampering by an unauthorized user returns `403` across all sensitive endpoints (dedicated matrix test).

---

## 12. Material IDOR

**Status: PASS** (fixed earlier this session, commit `12956ff`)

`GET /materials/:id` (`MaterialsService.findOne`, `backend/app/api/src/materials/materials.service.ts:103`) now calls `assertWarehouseAccess` after the existence check:

- Authorized → `200`
- Unauthorized warehouse → `403` (no material fields leak — confirmed by `materials.service.spec.ts:175`, "rejects direct ID access to a material in an unauthorized warehouse (403)")
- Unauthenticated → `401` (global JWT guard)
- Nonexistent ID → `404` (`findMaterialOrFail`)

This closes the exact gap flagged in the prior audit (`FRONTEND_AND_INVENTORY_FINAL_AUDIT.md §3`, "GET /materials/:id has no warehouse check") — that finding is now stale/fixed as of `12956ff`.

---

## 13. Inventory product isolation (warehouse + division)

**Status: PASS** — `warehouse-authorization-matrix.test.ts` item 10 ("Product Division Isolation: Recycling and Healthcare catalogs never leak into each other"), `product-division-isolation.spec.js`, and browser coverage in `test-warehouse-and-division-isolation.spec.js §3` for Calgary, Ontario, and Maple Ridge individually.

- `materials.division` (`recycling`/`healthcare`, not null) is a plain `WHERE` filter layered on top of warehouse scoping — no cross-division leak path.
- `materials.warehouse_id` (nullable FK): `NULL` = global product (visible everywhere, division-filtered); a UUID pins a product to one facility, enforced server-side by `assertWarehouseAccess` on both list and detail access (§12).
- A Healthcare product never appears in a Recycling view and vice versa; a facility-pinned product never appears to a user unauthorized for that facility.

---

## 14. SKU

**Status: PASS** — grep for `SKU` / `Product Code` / `Stock Keeping Unit` (case-insensitive) across `index.html`, `assets/app.js`, `assets/app.css` returns **zero matches**. No user-facing SKU field anywhere in the operational UI (Materials Catalog table, Add Product modal, invoice line items, History rows). Database column not touched (not required to be removed). Confirmed by `product-division-isolation.spec.js`.

---

## 15. History

**Status: PASS** — Inventory's primary tab is "Current Stock" (balances); the "Transactions Ledger" tab was removed entirely (`data-tab="transactions"` count: 0 in current markup). History (`renderHistoryTransactionsTable` + `openTransactionDetailModal`) provides the transaction timeline, per-row full detail (date/time, warehouse, division, type, product, quantity/weight or XL-L-M-S, container, seal, order ref, notes, recorded-by) and photos, with filtering/search UI. Verified by `history-transaction-detail.spec.js` (both cases now exercised end-to-end and passing — no longer skipped, since operational fixtures exist from this session's inbound/outbound tests prior to the §20 cleanup).

---

## 16. Invoice

**Status: PASS** — `invoice-document-mode.spec.js` + source review of `renderInvoiceDocumentView`/`renderInvoiceEditorForm` in `assets/app.js`.

- Create/Save/View/Edit/Print/PDF flows exercised (browser test + `test-warehouse-and-division-isolation.spec.js §7`).
- Saved/document mode (`.invoice-doc-readonly`) contains zero `<textarea>`/`<input>`/`<button>` elements — editable controls exist only in the separate edit-mode renderer.
- No SKU column in the line-item table.
- Payment Instructions and Notes render as plain text blocks (`.inv-doc-text-block`), not form fields.
- Totals block is right-justified, monospaced, dedicated (`Subtotal`/tax/`TOTAL`).
- `@media print` hides `.rail, .topbar, .tabbar, .noprint, .vhead, .vactions` — only the document itself prints/exports.

---

## 17. Full test suite (this session, current HEAD)

All checks were run for real this pass; none of these counts are reused from an earlier session.

| Check | Command | Result |
|---|---|---|
| Jest (API) | `npm --prefix backend/app/api test` (via `npm test`) | **137 passed, 137 total, 25 suites** |
| Unit | `npm --prefix backend run test:unit` | **28 passed, 0 failed** |
| Security | `npm --prefix backend run test:security` | **19 passed, 0 failed** |
| Acceptance | `npm --prefix backend run test:acceptance` | **34 passed, 0 failed** |
| Photo EXIF e2e | `npx jest --config ./test/jest-e2e.json photo-exif-security` (app/api) | **3 passed, 3 total** |
| Lint | `npm run lint` (ESLint, `backend/app/api`) | **0 errors** |
| Build | `npm run build` (NestJS API + Vite `app/web`) | **success, exit 0** |
| TSC | `npx tsc --noEmit` (`backend/app/api`) | **success, exit 0, no output** |
| Playwright (legacy root app) | `npx playwright test --config=tests/e2e-legacy/playwright.config.js` | **43 passed, 0 failed** (1 failure found and fixed mid-session — see §2) |
| Playwright (app/web) | `npm --prefix backend/app/web run test:e2e` | **29 passed, 0 failed** |

**Grand total: 293 automated tests run, 293 passed, 0 failed.**

---

## 18. Code quality

- No `any`, `@ts-ignore`, or `@ts-expect-error` introduced by this session's changes (`assets/app.css`, `tests/e2e-legacy/specs/global-chat.spec.js` — neither is TypeScript).
- No TypeScript, validation, or authorization logic was weakened. The one application-code change this session (`assets/app.css`) is CSS-only, restoring previously-working behavior; the customer-email, EXIF, chat SSE, and material-IDOR fixes (already on the branch from earlier this session) all *added* validation/authorization strictness, never removed it.
- `npx tsc --noEmit` clean (§17).

---

## 19. Git diff review

```
$ git status --short
 M assets/app.css
 M backend/app/web/playwright-report/index.html
 M tests/e2e-legacy/specs/global-chat.spec.js
?? FRONTEND_AND_INVENTORY_FINAL_AUDIT.md
?? FRONTEND_ARCHITECTURE_DECISION.md
?? tests/e2e-legacy/specs/responsive-visual-qa.spec.js
```

- `assets/app.css` — the mobile hamburger-nav fix (§2, item 1). Reviewed inline above; +6/-1 lines.
- `tests/e2e-legacy/specs/global-chat.spec.js` — the test-race fix (§2, item 2). +10/-2 lines.
- `backend/app/web/playwright-report/index.html` — a tracked Playwright HTML report artifact, regenerated by running the app/web e2e suite; not a source change (consistent with prior sessions' handling of this same file).
- `FRONTEND_AND_INVENTORY_FINAL_AUDIT.md`, `FRONTEND_ARCHITECTURE_DECISION.md` — audit docs written earlier this session, carried forward untouched.
- `tests/e2e-legacy/specs/responsive-visual-qa.spec.js` — new spec (25 tests) that surfaced §2 item 1; written earlier this session, verified/fixed-against this pass.
- No temporary files, screenshots, credentials, logs, generated secrets, or `.env` files staged or present in the diff.

---

## 20. Final test data state

Local database only (`greenwave_dev` on `localhost:5432`). Before/after counts from `backend/app/api/scripts/reset-local-test-data.js --yes`, run after all testing completed:

| Table | Before | After |
|---|---|---|
| materials (preserved) | 7 | 7 |
| user (preserved) | 24 | 24 |
| warehouses (preserved) | 3 | 3 |
| roles (preserved) | 3 | 3 |
| permissions (preserved) | 18 | 18 |
| role_permissions (preserved) | 33 | 33 |
| user_roles (preserved) | 3 | 3 |
| user_warehouses (preserved) | 32 | 32 |
| customers (preserved) | 15 | 15 |
| payments (operational) | 0 | 0 |
| invoice_items (operational) | 32 | 0 |
| invoices (operational) | 32 | 0 |
| photos (operational) | 20 | 0 |
| timesheets (operational) | 4 | 0 |
| chat_messages (operational) | 15 | 0 |
| inventory_transactions (operational) | 98 | 0 |
| containers (operational) | 23 | 0 |

Script output confirms: "Verified: every preserved table has an unchanged row count." No original products, users, warehouses, roles, permissions, or warehouse assignments were deleted.

---

## 21. Production status

**NOT DEPLOYED.** No deploy, merge, or push was performed. `gwgc.cloud` / `api.gwgc.cloud` remain on commit `25f3d57` (6+ commits behind this branch), unchanged. VM101, VM105, production PostgreSQL, production Redis, production MinIO, Management Portal production, and N8N were not accessed or modified.

---

## Summary table

| Area | Status |
|---|---|
| Authentication | PASS |
| RBAC | PASS |
| Warehouse access | PASS |
| Material IDOR | PASS |
| Product isolation | PASS |
| Division isolation | PASS |
| Inbound | PASS |
| Outbound | PASS |
| History | PASS |
| Photos | PASS |
| EXIF/GPS | PASS |
| Customers | PASS |
| Chat | PASS |
| Time clock | PASS |
| Invoice | PASS |
| Payment (provider-independent logic) | PASS |
| Stripe live round-trip | BLOCKED — Stripe account setup pending |
| Payment security | PASS |
| Responsive | PASS |
| Jest | PASS (137/137) |
| Playwright | PASS (72/72) |
| Lint | PASS |
| Build | PASS |
| TSC | PASS |
| Console | PASS (no unhandled errors observed across the Playwright run) |
| Network | PASS (no failed/unexpected network assertions across the Playwright run) |
| Test data | PASS — cleaned, preserved tables verified unchanged |
| Production status | NOT DEPLOYED |
