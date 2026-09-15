# GreenWave V2 Implementation Status

Branch: `greenwave-v2`, this repo (`anshrohitgwgc/Greenwaveapp`). This is the
unified status, frontend + backend, now that both live in one repository —
see `docs/REPOSITORY_ARCHITECTURE.md`. Module-level backend detail (which
migration added what, exact test file names) stays in
`backend/docs/V2_IMPLEMENTATION.md`; this file tracks status against the
brief's task list.

Status key: **IMPLEMENTED** (code exists, builds/lints clean) ·
**TESTED LOCALLY** (covered by the mocked/sqlite test suite) ·
**INTEGRATION TESTED** (Gate 1 — run for real against a rootless staging
Postgres/Redis/MinIO stack, no Docker, no mocks; see
`docs/V2_STAGING_REPORT.md`) ·
**BROWSER TESTED** (Gate 1 — real Playwright/Chromium against the Gate 1
staging API, all five required viewports plus an interactive click/fill
workflow; see `docs/V2_STAGING_REPORT.md`).

**Update (Gate 1, this pass):** every row below previously marked "NOT
INTEGRATION TESTED" / "NOT BROWSER TESTED" has now been run for real — see
`docs/V2_STAGING_REPORT.md` for full results, including two real bugs
found and fixed in the process (an `InvoiceItem` entity missing
`@JoinColumn`, and `/photos` accepting non-image files).

## Backend (`backend/app/api`)

54/54 tests passing (16 suites), 0 eslint errors, clean `nest build` —
reverified in this pass after the subtree merge (ran from
`backend/app/api` inside the unified repo, not the old standalone
checkout).

| Area | Status |
|---|---|
| Auth (login, bootstrap register, JWT, Redis rate limit) | TESTED LOCALLY + INTEGRATION TESTED |
| RBAC (`RolesGuard`, `@Roles`) | TESTED LOCALLY + INTEGRATION TESTED |
| Users, Warehouses, Customers, Materials | TESTED LOCALLY + INTEGRATION TESTED |
| Inventory (transactions, derived `inventory_balances` view, containers) | TESTED LOCALLY + INTEGRATION TESTED — Warehouse A/B isolation confirmed against real Postgres `NUMERIC` arithmetic; negative `adjustment` quantities are rejected by the current DTO (`@Min(0)`), no way to record a downward correction as validated today |
| Invoices (server-authoritative numbering, calculations, rebate lines, duplicate) | TESTED LOCALLY + INTEGRATION TESTED — **10** concurrent creates under real `FOR UPDATE` locking → 10 unique numbers, zero collisions, totals matching invoice #1114's real numbers exactly |
| Photos (MinIO upload, presigned URLs, IDOR guard) | TESTED LOCALLY + INTEGRATION TESTED — real upload → MinIO → presigned URL → byte-identical download → IDOR blocked (403); **found and fixed in this pass:** no MIME-type check existed, any file type was previously accepted |
| Timesheets (clock in/out, duplicate-shift guard, team view) | TESTED LOCALLY + INTEGRATION TESTED — 10 concurrent clock-ins → exactly 1 succeeded, 9 got 409, enforced by the DB partial unique index |
| Audit (append-only, sensitive-field scrub, search) | TESTED LOCALLY + INTEGRATION TESTED — 37 real events, no secrets found in any row |
| Security headers (helmet), global `ValidationPipe` | IMPLEMENTED |

## Frontend (`assets/`, `index.html`)

| Area | Status |
|---|---|
| Login (email+password against real API), bootstrap-only register | IMPLEMENTED, BROWSER TESTED |
| Session model (JWT in `sessionStorage`, never `localStorage`) | IMPLEMENTED |
| Staff/Users CRUD → `Api.listUsers/createUser/updateUser` | IMPLEMENTED, INTEGRATION TESTED |
| Warehouses → `Api.listWarehouses/createWarehouse/updateWarehouse` | IMPLEMENTED, INTEGRATION TESTED |
| Customers → `Api.listCustomers/createCustomer/updateCustomer` | IMPLEMENTED, BROWSER TESTED (added a customer via the real UI, persisted without reload) |
| Materials → `Api.listMaterials/createMaterial/updateMaterial` | IMPLEMENTED, INTEGRATION TESTED |
| Inventory/weigh-in → `Api.listContainers/createContainer/listInventoryTransactions/createInventoryTransaction/getInventoryBalances` | IMPLEMENTED, INTEGRATION TESTED |
| Invoices → `Api.listInvoices/getInvoice/createInvoice/updateInvoice/duplicateInvoice` | IMPLEMENTED, BROWSER TESTED (created a real invoice via the UI, server-assigned #) |
| Photos → `Api.listPhotos/getPhoto/uploadPhoto (multipart)/deletePhoto` | IMPLEMENTED, BROWSER TESTED (uploaded via the UI, thumbnail loaded a real presigned MinIO URL) |
| Time clock → `Api.clockIn/clockOut/currentShift/shiftHistory/teamShifts` | IMPLEMENTED, BROWSER TESTED (clocked in via the UI, visible state change) |
| History → `Api.listAudit` | IMPLEMENTED, INTEGRATION TESTED |
| `assets/store.js` reduced to client-local state only (session pointer, UI prefs, letterhead defaults, material entity/capture tag not present in the backend schema) | IMPLEMENTED |
| Service worker cache bump (`greenwave-v6`) with `assets/api.js` precached | IMPLEMENTED, BROWSER TESTED — genuine old-version-to-new-version upgrade verified, not simulated |

All four script files (`api.js`, `app.js`, `photos.js`, `store.js`) pass
`node --check`. Gate 1 (`docs/V2_STAGING_REPORT.md`) replaced the
route-name cross-check below with an actual round-trip: real requests from
a real browser, through this frontend, to the real staging API, to real
Postgres/MinIO, and back. Every `Api.*` call added to `assets/app.js` was
also cross-checked by hand against the corresponding backend controller's
route decorators (`backend/app/api/src/**/*.controller.ts`) — see the table
in `docs/V2_ARCHITECTURE.md`.

## Repository unification (this pass)

`backend/` was added via `git subtree add --prefix=backend`, not a squash
or copy — see `docs/REPOSITORY_ARCHITECTURE.md`. Confirmed:
`git merge-base --is-ancestor <backend-commit> HEAD` for the source repo's
`963201c` (V2 backend foundation) and `f6056f3` (its most recent commit)
both return true, i.e. the backend's full commit history is a real ancestor
of this repo's `greenwave-v2` branch.

## What's still open

1. ~~No integration test against real Postgres/Redis/MinIO.~~ **Done in
   Gate 1** — see `docs/V2_STAGING_REPORT.md`.
2. ~~No browser QA.~~ **Done in Gate 1** — real Playwright/Chromium, all
   five viewports plus an interactive workflow.
3. **Worker not split out.** `PhotosProcessor` (BullMQ) runs in-process in
   `backend/app/api` behind `WORKER_INLINE`, not as the standalone VM103
   deployable the production topology expects. Unchanged by Gate 1 — not
   required for this gate, and the ticket explicitly says not to deploy to
   VM103 yet.
4. **No refresh-token rotation**, single shared DB role (no DB-grant-level
   audit immutability yet) — both pre-existing, documented backend
   limitations, unchanged by this pass.
5. **No new automated frontend tests.** `assets/` has no JS test framework
   (intentionally: no-build-step, plain-script app — see `README.md`). The
   54 backend tests plus Gate 1's live functional/security tests are the
   coverage that exists; there's still no *automated* (CI-run) frontend
   test — Gate 1's browser QA was a manual Playwright script, not wired
   into `backend/.github/workflows/ci.yml`.
6. **Negative inventory adjustments** have no supported path — the
   `adjustment` transaction type's quantity fields are `@Min(0)`-validated,
   so there's no way to record a downward correction through
   `POST /inventory/transactions` as it stands today. Found during Gate 1;
   not fixed (unclear whether `outbound` is meant to cover this case
   instead — a product decision, not obviously a bug).

## Security review

Carried over unchanged from `backend/docs/V2_IMPLEMENTATION.md` (bootstrap
register no longer accepts a caller role, bcrypt 12 rounds + Redis login
rate limit, `JWT_SECRET` from env with a boot-time refusal if unset/`dev` in
production, IDOR-tested photo access, `esc()`-escaped error interpolation in
the gate). Nothing in this pass's frontend wiring changes that surface —
`assets/api.js` never stores a password, only a bearer JWT in
`sessionStorage`.
