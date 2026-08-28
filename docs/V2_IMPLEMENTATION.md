# GreenWave V2 Implementation Status — Frontend

Full backend status lives in `docs/V2_IMPLEMENTATION.md` in the
`FULL-INFRA-V.0001` repo (branch `greenwave-v2`). This is the frontend-only
summary.

## Done this pass

- `assets/api.js` — new API client (fetch-based, root routes, JWT in
  `sessionStorage`, no password ever stored client-side).
- Sign-in gate (`showGate()` in `assets/app.js`) rewritten to call the real
  `POST /auth/login` and bootstrap-only `POST /auth/register`, replacing
  the old "trusts the typed email" check. Generic error messages on 401 (no
  email enumeration).
- `boot()` now also checks `Api.isAuthenticated()` — fixes a real bug the
  session-model change would otherwise have introduced: a closed tab clears
  the JWT (sessionStorage) but previously left `db.session` (localStorage)
  looking valid, which would have shown the full app UI with no working
  session behind it.
- `Store.log()` (history/audit) now denormalizes the actor's name at write
  time — it used to key off `db.session`, which was a per-staff-record id
  and is now the single literal string `'server'` for every signed-in user,
  so the old lookup would have shown "Unknown" for every history entry.
- Staff view and invoice-add-staff help text corrected — they previously
  implied the local staff list controls sign-in; it no longer does.
- Service worker cache bumped (`greenwave-v5`) and `assets/api.js` added to
  its precache list.

## Not done this pass (known limitation, not an oversight)

Every other view — Invoices, Inventory/Weigh-in, Photos, Time clock,
Customers, Materials, the real Staff CRUD — still reads and writes
`localStorage`/IndexedDB (`assets/store.js`, `assets/photos.js`)
exactly as before. The backend already implements and tests all of this
(see the backend repo's implementation doc); `assets/api.js` already has
client methods ready (`createInvoice`, `createInventoryTransaction`,
`listPhotos`, `clockIn`/`clockOut`, `listAudit`, etc.). Wiring each view is
the next increment of work, sequenced after auth deliberately — auth was
the brief's explicitly highest-priority item and the one place the old
model had no real security at all.

## Testing

- `node --check` passed on all four script files (syntax only).
- No browser QA was performed — no display/browser was available in the
  environment this was implemented in, and a real run needs the backend
  actually serving requests (Postgres/Redis/MinIO), which this sandbox also
  doesn't have. See the backend repo's `V2_DEPLOYMENT_PLAN.md` §4 for the
  checklist to run before any real rollout.
- No JS unit-test framework exists in this repo (it's intentionally a
  no-build-step, plain-script app). Automated coverage for this pass lives
  entirely in the backend's 54 tests, which cover the auth logic this
  frontend now calls.
