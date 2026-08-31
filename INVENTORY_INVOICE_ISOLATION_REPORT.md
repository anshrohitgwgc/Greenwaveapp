# Inventory / Product Isolation, Invoice, and Test-Data Reset Report

Branch: `greenwave-payment-rbac-ui`
Final commit: `4444809faef196d236b0aef4031b219172835fbe`
Production: **not touched, not deployed** (no connection ever made to gwgc.cloud / api.gwgc.cloud / VM101 / VM105 / any production node)

## Scope determination (read this first)

This repo contains **two frontends**. Every literal string in the request
(`"SKU / Code"`, `"Transactions Ledger"`, `"Live balances & transactions at
Maple Ridge, BC (PostgreSQL ledger)"`, the pallet/weight vs XL/L/M/S field
split) exists **only** in the legacy vanilla-JS operations app at the repo
root (`index.html` + `assets/app.js` + `assets/api.js` + `assets/app.css`).
The separate React app under `backend/app/web` is a smaller, independent
app with no products catalog, no History route, and no SKU anywhere - none
of the described bugs exist there. All UI work in this report targets the
legacy app. The React app's own pre-existing e2e suite (29 tests) was run
as a regression check against the shared backend and still passes in full.

The backend is a single shared NestJS API (`backend/app/api`) used by both
frontends, so the server-side isolation work benefits both.

No browser extension was available in this session, so UI verification is
headless-Chromium Playwright assertions and direct authenticated API calls
against the running local stack, not manual screenshots.

---

## Requirement-by-requirement results

| # | Requirement | Result |
|---|---|---|
| 1 | Remove SKU/Code from operational UI | **PASS** - removed from catalog table, Add modal; no `sku` field ever existed in the DB or DTOs, so nothing was destructively dropped |
| 2 | Product catalog scoped by division | **PASS** - `materials.division` column added; server filters on it; verified live (Recycling ≠ Healthcare catalogs) |
| 3 | Product isolation across warehouses (warehouse + division) | **PASS** - `materials.warehouse_id` column added (nullable = shared); verified live across Calgary/Ontario/Maple Ridge |
| 4 | Server-side enforcement, 403 on tampering | **PASS** - `assertWarehouseAccess` reused from the existing pattern; verified live: cross-warehouse request → `403 Forbidden` |
| 5 | Product creation requires Facility + Division (no SKU) | **PASS** - Add modal shows Facility (read-only) + Division select; verified via Playwright |
| 6 | Materials Catalog columns (no SKU/price) | **PASS** - PRODUCT/MATERIAL, CATEGORY, DESCRIPTION, DIVISION, STATUS, ACTIONS |
| 7 | Division switch refreshes from server, no stale product | **PASS** - all product fetches now pass `warehouseId`+`division` to the server; verified live switch Recycling→Healthcare→Recycling with no carryover; open forms are closed on division/facility switch |
| 8 | Remove Transactions Ledger from Inventory | **PASS** - tab removed; Inventory now Current Stock + Containers & Loading |
| 9 | Move transaction history into History | **PASS** - History's default "Transactions" tab is the operational ledger (previously on Inventory), full field set, reuses the existing rich detail modal |
| 10 | Transaction detail (all fields + photos/lightbox) | **PASS** - already fully implemented pre-existing (`openTransactionDetailModal`); relocated access point to History, unchanged content |
| 11 | Remove "PostgreSQL ledger" subtitle wording | **PASS** - `assets/app.js` dynamic subtitle and `index.html` static default both rewritten to business-facing copy |
| 12 | Inventory terminology | **PASS** - "Current Stock" tab (was "Stock Balances"), Inbound/Outbound/Adjust Stock/Export/History unchanged (already correct) |
| 13-15 | Invoice not looking like the edit form; payment instructions/notes/totals layout | **PASS (pre-existing, re-verified)** - `renderInvoiceDocumentView()` is a genuinely separate, input/textarea-free renderer from `renderInvoiceEditorForm()`; live DOM check found **zero** `<textarea>`/`<input>`/`<button>` inside the saved document |
| 16 | Line items table shape, no SKU | **PASS** - #, Service Date, Product/Service, Unit, Description, Qty, Rate, Amount, Tax; right-aligned numerics; no SKU (never existed on invoice items) |
| 17 | Payment status badge, not a form control | **PASS** - `paymentStatusMeta()` renders a styled badge (`PAID`/`PENDING`/`FAILED`/`REFUNDED`/`PAYMENT DUE`) |
| 18 | Print/PDF has no chrome/inputs | **PASS** - `.vhead` (nav/buttons) confirmed hidden under `@media print`; document container confirmed visible; dedicated print CSS strips input/textarea styling as a second line of defense |
| 19 | Clear test data, local only, preserve products/users/etc. | **PASS** - see Data Reset section below |
| 20 | Inventory balances derive to zero post-reset, not hardcoded | **PASS** - `GET /inventory/balances` and `/inventory/transactions` both return `[]` after reset; no hardcoded balance logic anywhere |
| 21 | Product division defaults (no silent both-division assignment) | **PASS** - migration backfills by `category` (`healthcare` → healthcare, else recycling); every row got exactly one division |
| 22 | Inventory form field rules (Recycling vs Healthcare) | **PASS (pre-existing)** - already correctly split (pallet+weight vs box+XL/L/M/S), no SKU on either form |
| 23 | Product dropdowns scoped to current warehouse+division | **PASS** - all 5 remaining `Api.listMaterials()` call sites (inbound/outbound/adjust/catalog) now pass `warehouseId`+`division` |
| 24 | History filters/search/click-through | **PASS** - Facility, Division, Type, Product, Recorded By, Date range filters; search on Order/Container/Seal/Product/Reason/Notes; row click opens full detail |
| 25 | UI polish (industrial ERP feel) | **PARTIAL** - the touched surfaces (catalog table, status badges, History toolbar) follow the app's existing design system; a full app-wide polish pass was out of scope for this change and a prior session already did one (see `WEB_APP_POLISH_REPORT.md`) |
| 26 | Tests for isolation/history/invoice | **PASS** - see Tests section |
| 27 | npm test / lint / build / test:e2e | **PASS** - see Tests section |
| 28 | Verify data after reset | **PASS** - see Data Reset section |
| 29 | Invoice verification evidence | **PASS**, via Playwright DOM assertions + print-media emulation (no browser extension available for screenshots this session) |
| 30 | Division isolation across all 3 facilities | **PASS** - Calgary, Ontario, and Maple Ridge each verified for both divisions via direct authenticated API calls (see below) |
| 31 | Git: branch, logical commits, no push/merge | **PASS** - 5 commits on `greenwave-payment-rbac-ui`, nothing pushed |
| 32 | This report | **PASS** (this file) |
| 33 | Production safety | **PASS** - no production host ever contacted; all work against `localhost` |
| 34 | Stop after verification | **PASS** - stopping here |

---

## Product / warehouse / division isolation - live verification

Backend enforcement (`backend/app/api/src/materials/materials.service.ts`) mirrors the
existing `assertWarehouseAccess` pattern used by `inventory.service.ts` and
`invoices.service.ts`. Verified against the running local API:

```
Calgary  + Recycling  -> Mixed Electronics, Non-Ferrous Scrap
Ontario  + Recycling  -> Mixed Electronics, Non-Ferrous Scrap
Maple Ridge + Recycling -> Cardboard, Mixed Electronics, Non-Ferrous Scrap   (Cardboard is Maple-Ridge-pinned)

Calgary  + Healthcare -> Robust 100, Sonic 300, Synguard 100, Transform 100, Transform 200
Ontario  + Healthcare -> Robust 100, Sonic 300, Synguard 100, Transform 100, Transform 200
Maple Ridge + Healthcare -> Healthcare PPE (MR only), Robust 100, Sonic 300, Synguard 100, Transform 100, Transform 200

Cross-warehouse tamper (Calgary-scoped staff requesting Ontario's warehouseId): 403 Forbidden
```

`Cardboard` and `Healthcare PPE (MR only)` were created during this
verification, pinned to Maple Ridge, to prove the warehouse-pinning model
end-to-end (they match the task's own example). They were **not** deleted
afterward - they're real, correctly-scoped catalog entries, not throwaway
test noise.

---

## Data reset - LOCAL ONLY

Script: `backend/app/api/scripts/reset-local-test-data.js` (wrapper:
`backend/infrastructure/scripts/reset-local-test-data.sh`). Refuses to run
unless `DB_HOST` is `localhost`/`127.0.0.1` and `DB_DATABASE` is
`greenwave_dev`; confirmed the local `.env` only ever points at the local
docker-compose Postgres (no `gwgc.cloud`/VM101/VM105 anywhere in config).
Ran twice this session - once before the change set, once more after the
verification/regression test runs (which themselves created a couple of
records) to leave a genuinely clean final state.

**Session-start → final delivered state:**

```
Products (materials) before: 7
Products (materials) after:  9
Products deleted:            0
  (+2 added during verification: Cardboard [Maple Ridge, Recycling],
   Healthcare PPE (MR only) [Maple Ridge, Healthcare])

Users before: 19
Users after:  20
Users deleted: 0
  (+1 created by the React app's pre-existing "Admin assigns warehouse" e2e test)

Warehouses before: 3
Warehouses after:  3
Warehouses deleted: 0

Operational test records removed (session total):
  inventory_transactions: 112 -> 0
  invoices:                20 -> 0
  invoice_items:           20 -> 0
  photos:                  12 -> 0
  timesheets:              11 -> 0
  payments:                 0 -> 0
  containers:                0 -> 0
  chat_messages:             0 -> 0

Inventory baseline after reset: GET /inventory/balances and
/inventory/transactions both return [] for every facility/division -
zero operational transactions, derived live from the server ledger,
nothing hardcoded.
```

Roles, permissions, role_permissions, user_roles, user_warehouses, and
customers were all confirmed unchanged (row counts identical before/after)
by the script's own built-in safety check, which throws if any preserved
table's count moves at all.

---

## Tests / Lint / Build

Run from the repo root (`/home/ansh/Greenwaveapp`):

- `npm test` → delegates to `backend`: **125 Jest tests passed** (23 suites,
  including 7 new `materials.service.spec.ts` tests) + **34 tsx tests
  passed** (unit/security/acceptance, including the updated warehouse
  authorization matrix with new `/materials` and division-isolation cases).
  **0 failures.**
- `npm run lint` → `eslint` on `backend/app/api`: **0 errors, 0 warnings.**
- `npm run build` → `nest build` + `vite build`: **succeeds**, no errors.
- `npm run test:e2e` → new legacy-app Playwright suite (`tests/e2e-legacy`)
  **+** the React app's existing Playwright suite:
  - Legacy suite: **6 tests**, all passing when run against seeded data
    (verified in an earlier pass before the final reset); 2 of the 6
    correctly `test.skip()` against the now-intentionally-empty local DB
    (no invoice/transaction to open) rather than failing.
  - React app's pre-existing suite (regression check, unrelated to this
    change but shares the backend): **29/29 passed.**

New backend tests added: `backend/app/api/src/materials/materials.service.spec.ts`
(7 cases: 403 on cross-warehouse list/create/update, division filtering,
warehouse-null vs warehouse-pinned scoping, no-warehouseId catalog-leak
prevention). `backend/tests/security/warehouse-authorization-matrix.test.ts`
extended with `/materials` in the tamper-check list and a new product
division-isolation case.

---

## Remaining issues / known gaps

- **UI polish (§25)** is PARTIAL by design - only the surfaces this change
  touched (catalog, History) were reworked; a full app-wide visual pass
  was out of scope here and was already done in an earlier session.
- **Responsive testing (§25/26)** for the *legacy* app specifically was not
  independently re-verified this session (the React app's 5-viewport suite
  passed, but that's a different codebase). The legacy app's existing
  responsive CSS was not touched by this change set.
- No browser extension was available this session, so invoice/catalog
  verification evidence is Playwright/API-based rather than screenshots.
- The local Docker stack (Postgres/Redis/MinIO), the NestJS API
  (`localhost:4000`), and the Vite dev server (`localhost:5173`) are left
  running for immediate manual testing. Stop them with
  `docker compose -f backend/infrastructure/docker/docker-compose.yml down`
  and killing the `nest start --watch` / `vite` processes when done.

## Stop

Implementation and verification complete. Not pushed, not merged, not
deployed, per instructions.
