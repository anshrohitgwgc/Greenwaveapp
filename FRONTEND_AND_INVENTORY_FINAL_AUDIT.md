# Frontend & Inventory Final Audit — GreenWave V2

**Branch:** `greenwave-payment-rbac-ui`
**Commit:** `cfb31c3`
**Production:** NOT DEPLOYED (this branch's changes are not live)

---

## 1. Frontend architecture

Full evidence and reasoning: see `FRONTEND_ARCHITECTURE_DECISION.md`.

- **Canonical frontend:** repository-root vanilla JS app (`/index.html`,
  `/assets/*`). No `frontend/` directory move, no deletion of `backend/app/web`.
- **Production frontend:** confirmed live at `https://gwgc.cloud/` (read-only
  fetch) — byte-identical to the root app's `index.html` at commit `25f3d57`,
  6 commits behind current HEAD. Not `backend/app/web`.
- **Current branch frontend:** root vanilla JS app — every recent frontend
  feature commit (SKU removal, division scoping, History/ledger move, invoice
  print rework, payment-RBAC UI) touched only `assets/*`/`index.html`.
  `backend/app/web` (React/Vite) is unchanged since `25f3d57` and not deployed.
- **Inventory / Materials Catalog / Invoices:** Inventory and Invoices exist
  in both apps (root is current; `app/web`'s versions are stale, pre-dating
  division isolation and payment RBAC). Materials Catalog exists **only** in
  the root app.
- **Future UI changes:** target the root app only.

## 2. SKU status

No `SKU` string appears anywhere in `index.html`, `assets/app.js`, or
`assets/app.css`. Materials Catalog table, Add Product modal, invoice line
items, and history rows all omit it. Confirmed by grep and by e2e spec
`tests/e2e-legacy/specs/product-division-isolation.spec.js` (passing).

## 3. Product warehouse isolation

Schema: `materials.warehouse_id` (nullable FK → `warehouses.id`, `ON DELETE
SET NULL`). `NULL` = global/shared product; a UUID pins a product to one
facility.

Server-side (`MaterialsService`):
- `create`/`update` call `assertWarehouseAccess(actor, warehouseId)` → 403
  for unauthorized warehouses. Verified live: `GET /materials?warehouseId=<Ontario>`
  as a Calgary-only staff user → `403 Forbidden`.
- `findAll` scopes to the caller's authorized warehouses (or global-only) when
  no `warehouseId` is given, so the full catalog never leaks facility-pinned
  products to an unauthorized viewer.

**Finding — `GET /materials/:id` has no warehouse check.**
`MaterialsController.findOne` calls `MaterialsService.findOne(id)` directly,
which does a bare `findOne({ where: { id } })` with no call to
`assertWarehouseAccess` and no ownership/authorization check of any kind.
Verified live: created a temporary Ontario-only healthcare product as admin,
then fetched it by ID as a Calgary-only staff user (`hasGlobalAccess: false`,
`warehouses: ['Calgary, AB']`) — response was `200 OK` with the full record,
including `warehouseId`. This violates the requirement that a user cannot
bypass the UI by hitting the API directly. The temporary probe product was
deleted immediately after the test; it left no residue (product count
returned to 7 before and after).
*Not fixed in this pass — task scope was audit-only, no code changes
requested for section 9 beyond verification.*

## 4. Product division isolation

`materials.division` (`recycling` | `healthcare`, not null). `findAll`
filters by exact match when `division` is passed; there is no cross-division
leak path since it's a plain `WHERE` clause layered on top of the (correct)
warehouse scoping. Confirmed via e2e (`Recycling and Healthcare isolation for
Calgary/Ontario/Maple Ridge`, `UI Division Switcher toggles fields and
prevents stale value leakage` — both passing in `app/web`'s Playwright suite).

Combination coverage (from current data + schema, no duplicate products
created to force this):

| Warehouse | Recycling | Healthcare |
|---|---|---|
| Calgary | ✅ (global products, division=recycling) | ✅ (global products, division=healthcare) |
| Ontario | ✅ (global products) | ✅ (global products) |
| Maple Ridge | ✅ (global products) | ✅ (global products) |

All 7 remaining products are global (`warehouse_id IS NULL`), so they're
visible in every facility, filtered only by division — this is correct
per-schema behavior, not a gap; warehouse-pinning is exercised by the schema
and by the (now-deleted) demonstration products, not by permanent fixtures.

## 5. Inventory

- Primary tab is **"Current Stock"** (balances), not "Transactions Ledger" —
  the ledger tab was removed entirely (`data-tab="transactions"` count: 0).
- Subtitle: `"Current inventory and operations."` — does not contain the
  forbidden "Live balances & transactions at Maple Ridge, BC (PostgreSQL
  ledger)." text (and production's older subtitle, "Live multi-warehouse
  inventory balances, container tracking, and transaction ledger.", is also
  different from the forbidden string — moot either way since HEAD's text is
  clean).
- Recycling: PALLETS unit, optional weight (KG/LB), no XL/L/M/S columns.
  Totals column = pallet quantity sum.
- Healthcare: BOXES unit, XL/L/M/S columns, no weight field. Totals column =
  XL+L+M+S sum (server enforces `total = XL+L+M+S` on write).

## 6. History

Contains the transaction timeline (`renderHistoryTransactionsTable`) and a
per-transaction detail modal (`openTransactionDetailModal`) with: date/time,
warehouse, division, type (IN/OUT/ADJ), product, quantity, weight (recycling
only) or XL/L/M/S breakdown (healthcare only), container number, seal
number, order/reference #, BL/tracking #, shipping line, ETA, recorded by,
notes/reason, and associated photos (thumbnail grid → lightbox). All fields
present in the current build.

## 7. Invoice document

- Saved/View-mode document (`renderInvoiceDocumentView`, `.invoice-doc-readonly`)
  contains zero `<textarea>`, `<input>`, or `<button>` elements — verified
  both by source read and by the passing e2e spec
  `invoice-document-mode.spec.js` (skipped in this run only because the
  clean local fixture set has no saved invoices to click into — see §9).
  Editable inputs/textareas live exclusively in the separate edit-mode
  renderer (`renderInvoiceEditorForm`).
- No SKU field in the line-item table (Product/service, Unit, Description,
  Qty, Rate, Amount, Tax — no SKU column).
- Payment instructions and notes render as plain text blocks
  (`.inv-doc-text-block`), not form fields.
- Totals column (`Subtotal` / tax / `TOTAL`) is a dedicated aligned block,
  right-justified, monospaced values.
- `@media print` rules hide `.rail, .topbar, .tabbar, .noprint, .vhead,
  .vactions` — only the document renders when printing/PDF-exporting.

## 8. Test-data cleanup

**Products:** identified the exact 2 test-only products from the previous
run by created_at timestamp and UUID shape (seed data uses fixed
`44444444…`/`77777777…`-style UUIDs created at
`2026-08-30 03:59:28`; the 2 additions used random UUIDs created a day later
and were the only two with a non-null `warehouse_id`):

| Deleted | ID | Division | Warehouse |
|---|---|---|---|
| Cardboard | `240dbf8c-a3c2-4406-9bc4-0deff6e320d0` | recycling | Maple Ridge, BC |
| Healthcare PPE (MR only) | `f011c7e0-93c5-48d0-90b6-982f6c8651a5` | healthcare | Maple Ridge, BC |

Confirmed zero FK references (`containers`, `inventory_transactions`) before
deleting. Both matched exactly what `INVENTORY_INVOICE_ISOLATION_REPORT.md`
(§ from the prior run) named as the isolation-demo additions.

**Operational tables:** `payments`, `invoice_items`, `invoices`, `photos`,
`timesheets`, `chat_messages`, `inventory_transactions`, `containers` were
all already at `0` — `backend/app/api/scripts/reset-local-test-data.js
--yes` was not needed (dry-run confirmed nothing to clear). Preserved tables
(`materials`, `user`, `warehouses`, `roles`, `permissions`,
`role_permissions`, `user_roles`, `user_warehouses`, `customers`) untouched.

## 9. Tests / Lint / Build / E2E (this session, HEAD `cfb31c3`)

| Check | Result |
|---|---|
| `npm test` (backend Jest: 23 suites/125 tests + unit 28 + security 19 + acceptance 34) | **210 passed, 0 failed** |
| `npm run lint` (ESLint, `backend/app/api`) | **0 errors** |
| `npm run build` (NestJS API + Vite `app/web`) | **success**, 0 errors |
| `npm run test:e2e` (legacy-app Playwright: 6 specs; `app/web` Playwright: 29 specs) | **33 passed, 2 skipped, 0 failed** |

The 2 skipped e2e specs (`History shows the transaction timeline by
default…`, `a saved invoice opened via View has no textareas/inputs…`) are
conditional `test.skip()`s that fire because the clean local fixture set has
0 inventory transactions and 0 saved invoices (§8) — not failures, but a
real coverage gap: those two checks aren't currently exercised end-to-end.
Worth seeding one throwaway transaction/invoice next time e2e coverage of
those two flows actually needs to run green rather than skip.

## 10. Git diff

`git status --short`: only `backend/app/web/playwright-report/index.html`
modified — a tracked Playwright HTML report regenerated by running
`test:e2e` in this session, not a source change. `git diff HEAD~1..HEAD`:
only the previous run's `INVENTORY_INVOICE_ISOLATION_REPORT.md` addition.
No unintended source changes. Nothing committed or pushed this session.

## Production

**NOT DEPLOYED.** No deploy, merge, or push performed. `gwgc.cloud` remains
on commit `25f3d57`, unchanged by this audit.
