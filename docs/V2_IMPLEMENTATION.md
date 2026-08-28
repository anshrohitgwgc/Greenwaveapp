# GreenWave V2 Implementation Status

Branch: `greenwave-v2`. Base: `development` (`6e13686`). This tracks what is
actually done, module by module, against the brief — see
`docs/V2_ARCHITECTURE.md` for the design and its documented assumptions.

Status key: **IMPLEMENTED** (code exists, builds, unit-tested with mocks) ·
**TESTED LOCALLY** (also covered by the sqlite HTTP integration spec) ·
**NOT INTEGRATION TESTED** (never run against real Postgres/Redis/MinIO —
this sandbox has neither docker nor local instances of them) ·
**NOT WIRED IN FRONTEND** (backend done, `Greenwaveapp` doesn't call it yet).

## Backend (`app/api`)

| Area | Status |
|---|---|
| Health (`GET /health`) | IMPLEMENTED (pre-existing, unchanged) |
| Auth (login, bootstrap-only register, JWT, rate limit) | TESTED LOCALLY — 11 HTTP-level tests in `auth-rbac.integration.spec.ts` |
| RBAC (`RolesGuard`, `@Roles`) | TESTED LOCALLY — unit tests + exercised through the integration spec |
| Users (create/list/me/update) | TESTED LOCALLY (via integration spec) |
| Roles/permissions schema + read endpoints | IMPLEMENTED, NOT INTEGRATION TESTED (no seed-verification run against real Postgres) |
| Warehouses | IMPLEMENTED, NOT INTEGRATION TESTED |
| Customers | IMPLEMENTED, NOT INTEGRATION TESTED |
| Materials | IMPLEMENTED, NOT INTEGRATION TESTED |
| Inventory transactions + derived balances view + containers | IMPLEMENTED, unit-tested (adjustment/reason/role rules), NOT INTEGRATION TESTED — the `inventory_balances` view has never actually run against Postgres |
| Invoices (numbering, calculations, rebate lines, duplicate) | IMPLEMENTED, unit-tested (`invoices.calculations.spec.ts` verifies the exact numbers from the production invoice #1114 example), NOT INTEGRATION TESTED — the counter-table numbering path has only run against sqlite in tests, never Postgres with `FOR UPDATE` under real concurrency |
| Photos (MinIO upload, presigned URLs, IDOR guard) | IMPLEMENTED, unit-tested (IDOR cases), NOT INTEGRATION TESTED — no real MinIO available in this sandbox, so the actual `putObject`/`presignedGetObject` calls have never executed |
| Timesheets (clock in/out, duplicate guard, team view) | TESTED LOCALLY (unit) — the *DB-level* partial unique index guard (the race-safe part) is NOT INTEGRATION TESTED, only the application-level check is |
| Audit (append-only, sensitive-field scrub, search) | TESTED LOCALLY (unit) |
| Security headers (helmet), global ValidationPipe | IMPLEMENTED |

**Lint/build:** 0 eslint errors, clean `nest build`, 54/54 tests passing
(16 suites) as of commit `cd0ac81`.

## Frontend (`Greenwaveapp`)

| Area | Status |
|---|---|
| Real email+password login/bootstrap against the API | TESTED LOCALLY (JS syntax-checked; no browser QA run — see below) |
| Session model (JWT in sessionStorage, not localStorage) | IMPLEMENTED |
| History/audit actor attribution fix (was broken by the session model change) | IMPLEMENTED |
| Service worker cache bump + api.js precached | IMPLEMENTED |
| `assets/api.js` client methods for invoices/inventory/photos/timesheets/audit | IMPLEMENTED, **NOT WIRED IN FRONTEND** — the views that use these (Invoices, Inventory, Photos, Time clock, Customers, Materials, the real Staff CRUD) still read/write `localStorage`/IndexedDB, not the API |
| Staff view | Local-only display; copy corrected to stop implying it controls sign-in (it doesn't any more) |

## What "NOT WIRED IN FRONTEND" means concretely

Auth was the one area the brief called highest priority, and it's the one
area that changed end to end: browser → API → Postgres, with no
client-side trust decision left in the loop. Every other view in
`Greenwaveapp` still works exactly as it did before this pass — it's a
fully functional local-only app with real numbers, real invoice math, real
photo storage in IndexedDB — it just isn't yet talking to the new,
already-tested backend for that data. That is the largest remaining
increment of work, and it's now mechanical: `assets/api.js` already has
`createInvoice`, `createInventoryTransaction`, `listPhotos`, `clockIn`/
`clockOut`, etc., built and ready to call from each view's existing
save/load functions.

## Why nothing here was integration-tested against real infra

This sandbox has no Docker, no local PostgreSQL/Redis/MinIO server, and (per
the DO-NOT-TOUCH constraints) must not connect to the real
192.168.1.12/14/21/22/23/31 hosts. `docs/DEVELOPER-HANDOFF.md`'s
`setup-local-dev.sh` + `docker compose` path is the correct way to actually
integration-test this — it just could not be run *here*. The 54 automated
tests substitute an in-memory sqlite database and mocked Redis/MinIO for
that; they prove the application logic is correct, not that the real
Postgres 16 / Redis 7 / MinIO stack behaves identically (row-locking under
real concurrency, MinIO's actual S3 semantics, etc.).

## Security review (see also docs/V2_ARCHITECTURE.md)

- **Fixed**: `POST /auth/register` previously accepted a caller-supplied
  `role`, letting anyone self-register as admin. Now bootstrap-only, no
  `role` field exists on the DTO at all, and it 409s once any user exists.
- **Fixed**: passwords went from bcrypt(10) with no login rate limiting to
  bcrypt(12) + a Redis-backed fixed-window limiter on `/auth/login`.
- **Fixed**: the hardcoded JWT secret (`'greenwave-secret-key'` in source)
  now comes from `JWT_SECRET` env, and `main.ts` refuses to boot in
  production with an unset or `dev`-labeled secret.
- **IDOR**: verified by test — a STAFF/DRIVER token cannot list or fetch
  another user's photos by id (`photos.service.spec.ts`).
- **XSS**: the frontend's existing `esc()` helper (pre-existing, unchanged)
  is used for all new gate-form messages that interpolate a server error
  message.
- **CSRF**: not applicable in the traditional sense — auth is bearer-JWT,
  not cookies, so there's no ambient credential for a cross-site request to
  ride on.
- **Not done in this pass**: a real least-privileged Postgres role for the
  application (audit immutability is currently enforced at the API layer
  only, not the DB grant layer); refresh-token rotation; a `helmet` CSP
  tuned for this app specifically (default helmet config only).
