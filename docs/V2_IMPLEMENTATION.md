# GreenWave V2 Implementation Status

Branch: `greenwave-v2`, this repo (`anshrohitgwgc/Greenwaveapp`). This is the
unified status, frontend + backend, now that both live in one repository —
see `docs/REPOSITORY_ARCHITECTURE.md`. Module-level backend detail (which
migration added what, exact test file names) stays in
`backend/docs/V2_IMPLEMENTATION.md`; this file tracks status against the
brief's task list.

Status key: **IMPLEMENTED** (code exists, builds/lints clean) ·
**TESTED LOCALLY** (covered by the mocked/sqlite test suite) ·
**NOT INTEGRATION TESTED** (never run against real Postgres/Redis/MinIO —
this sandbox has neither Docker nor local instances of them, and per the
task's own constraints must not connect to the real 192.168.1.x hosts) ·
**NOT BROWSER TESTED** (no display/browser available in this sandbox).

## Backend (`backend/app/api`)

54/54 tests passing (16 suites), 0 eslint errors, clean `nest build` —
reverified in this pass after the subtree merge (ran from
`backend/app/api` inside the unified repo, not the old standalone
checkout).

| Area | Status |
|---|---|
| Auth (login, bootstrap register, JWT, Redis rate limit) | TESTED LOCALLY |
| RBAC (`RolesGuard`, `@Roles`) | TESTED LOCALLY |
| Users, Warehouses, Customers, Materials | IMPLEMENTED; users/auth path TESTED LOCALLY via the integration spec, the rest NOT INTEGRATION TESTED |
| Inventory (transactions, derived `inventory_balances` view, containers) | TESTED LOCALLY (adjustment/reason/role rules); the view itself NOT INTEGRATION TESTED against real Postgres |
| Invoices (server-authoritative numbering, calculations, rebate lines, duplicate) | TESTED LOCALLY (verified against production invoice #1114's real numbers); counter-table concurrency under `FOR UPDATE` NOT INTEGRATION TESTED (sqlite can't prove that) |
| Photos (MinIO upload, presigned URLs, IDOR guard) | TESTED LOCALLY (IDOR cases); actual MinIO `putObject`/`presignedGetObject` NOT INTEGRATION TESTED |
| Timesheets (clock in/out, duplicate-shift guard, team view) | TESTED LOCALLY (application-level check); the DB partial-unique-index race guard NOT INTEGRATION TESTED |
| Audit (append-only, sensitive-field scrub, search) | TESTED LOCALLY |
| Security headers (helmet), global `ValidationPipe` | IMPLEMENTED |

## Frontend (`assets/`, `index.html`)

| Area | Status |
|---|---|
| Login (email+password against real API), bootstrap-only register | IMPLEMENTED, NOT BROWSER TESTED — `node --check` syntax-clean |
| Session model (JWT in `sessionStorage`, never `localStorage`) | IMPLEMENTED |
| Staff/Users CRUD → `Api.listUsers/createUser/updateUser` | IMPLEMENTED, NOT BROWSER TESTED |
| Warehouses → `Api.listWarehouses/createWarehouse/updateWarehouse` | IMPLEMENTED, NOT BROWSER TESTED |
| Customers → `Api.listCustomers/createCustomer/updateCustomer` | IMPLEMENTED, NOT BROWSER TESTED |
| Materials → `Api.listMaterials/createMaterial/updateMaterial` | IMPLEMENTED, NOT BROWSER TESTED |
| Inventory/weigh-in → `Api.listContainers/createContainer/listInventoryTransactions/createInventoryTransaction/getInventoryBalances` | IMPLEMENTED, NOT BROWSER TESTED |
| Invoices → `Api.listInvoices/getInvoice/createInvoice/updateInvoice/duplicateInvoice` | IMPLEMENTED, NOT BROWSER TESTED |
| Photos → `Api.listPhotos/getPhoto/uploadPhoto (multipart)/deletePhoto` | IMPLEMENTED, NOT BROWSER TESTED |
| Time clock → `Api.clockIn/clockOut/currentShift/shiftHistory/teamShifts` | IMPLEMENTED, NOT BROWSER TESTED |
| History → `Api.listAudit` | IMPLEMENTED, NOT BROWSER TESTED |
| `assets/store.js` reduced to client-local state only (session pointer, UI prefs, letterhead defaults, material entity/capture tag not present in the backend schema) | IMPLEMENTED |
| Service worker cache bump (`greenwave-v5`) with `assets/api.js` precached | IMPLEMENTED |

All four script files (`api.js`, `app.js`, `photos.js`, `store.js`) pass
`node --check`. Every `Api.*` call added to `assets/app.js` was cross-checked
by hand against the corresponding backend controller's route decorators
(`backend/app/api/src/**/*.controller.ts`) — see the table in
`docs/V2_ARCHITECTURE.md`. This is route/method-name verification, not a
runtime integration test: no request has actually round-tripped browser →
API → Postgres/MinIO in this sandbox.

## Repository unification (this pass)

`backend/` was added via `git subtree add --prefix=backend`, not a squash
or copy — see `docs/REPOSITORY_ARCHITECTURE.md`. Confirmed:
`git merge-base --is-ancestor <backend-commit> HEAD` for the source repo's
`963201c` (V2 backend foundation) and `f6056f3` (its most recent commit)
both return true, i.e. the backend's full commit history is a real ancestor
of this repo's `greenwave-v2` branch.

## What's still open

1. **No integration test against real Postgres/Redis/MinIO.** Required
   before any staging rollout — see `docs/V2_PRODUCTION_MIGRATION_PLAN.md`.
2. **No browser QA.** This sandbox has no display. The viewport/workflow
   checklist (390×844, 430×932, plus desktop sizes) has not been run against
   a live browser — only static syntax/route verification.
3. **Worker not split out.** `PhotosProcessor` (BullMQ) runs in-process in
   `backend/app/api` behind `WORKER_INLINE`, not as the standalone VM103
   deployable the production topology expects.
4. **No refresh-token rotation**, single shared DB role (no DB-grant-level
   audit immutability yet) — both pre-existing, documented backend
   limitations, unchanged by this pass.
5. **No new automated frontend tests.** `assets/` has no JS test framework
   (intentionally: no-build-step, plain-script app — see `README.md`). The
   54 backend tests are the only automated coverage of the logic the
   frontend now calls; they don't exercise the frontend code itself.

## Security review

Carried over unchanged from `backend/docs/V2_IMPLEMENTATION.md` (bootstrap
register no longer accepts a caller role, bcrypt 12 rounds + Redis login
rate limit, `JWT_SECRET` from env with a boot-time refusal if unset/`dev` in
production, IDOR-tested photo access, `esc()`-escaped error interpolation in
the gate). Nothing in this pass's frontend wiring changes that surface —
`assets/api.js` never stores a password, only a bearer JWT in
`sessionStorage`.
