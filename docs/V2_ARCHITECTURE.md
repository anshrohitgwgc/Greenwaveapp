# GreenWave V2 Architecture — Frontend

This repo (`Greenwaveapp`, the production PWA) is the **client**. It is not
where V2's backend lives — the backend, database schema, RBAC, invoices,
inventory ledger, photo storage, timesheets and audit log are implemented in
the `FULL-INFRA-V.0001` repo's `app/api` (NestJS), on branch `greenwave-v2`.
That repo's `docs/V2_ARCHITECTURE.md` is the authoritative design doc; this
file only covers how this frontend fits in.

## Why two repos

When this V2 work started, a backend already existed as a separate,
production-connected repository (`greenwave-api`), and a further,
already-scaffolded, production-isolated monorepo (`FULL-INFRA-V.0001`,
containing `app/api` + `app/web` + `app/mobile` + full docs/infra-as-code)
turned out to be a closer match to what this task needed than building a
third, independent backend inside this static-site repo. V2 backend work
went there; this repo stays the frontend.

## Client state vs. server-authoritative state

This app has always kept its data in `localStorage`/IndexedDB (see
`assets/store.js`, `assets/photos.js`) — that was true before this pass and
is still true for most views today. What changed in this pass:

- **Authentication is now server-authoritative.** `assets/api.js` calls the
  real API's `POST /auth/login` / `POST /auth/register` (bootstrap-only).
  The JWT lives in `sessionStorage` (cleared when the tab closes), never in
  `localStorage`, and no password is ever stored in the browser at all. See
  the "Signing in" section of this repo's `README.md`.
- **Everything else — invoices, inventory, customers, materials, photos,
  the local staff list, history** — still reads/writes
  `localStorage`/IndexedDB via `Store`/`Photos` in this pass. The backend
  already has real, tested endpoints for all of it; `assets/api.js` already
  has client methods ready for them (`createInvoice`, `createInventoryTransaction`,
  `listPhotos`, `clockIn`/`clockOut`, etc.). Wiring each view to call them
  instead of local storage is the next increment — see
  `docs/V2_IMPLEMENTATION.md` for exactly what's done vs. pending.

The browser must not be treated as authoritative for production business
data once that wiring lands — `localStorage` becomes a read-through cache /
offline queue in front of the API, the same pattern already used for auth.

## Why auth first

The brief marked authentication as the highest-priority item, and for good
reason: the pre-V2 gate trusted whatever email a user typed, with no
password check at all (see git history — this was accurately documented in
the old README as "a front door, not a lock"). That was the most serious gap
and is now closed. Wiring the remaining views to the API is real, bounded,
mechanical work on top of an API that's already implemented and tested —
it's sequenced after auth deliberately, not skipped.

## Logo, PWA, mobile

Unchanged in this pass: `assets/logo.png` is still used at login, in the
sidebar, and (unwired to the new invoice endpoints yet) on printed invoices;
the service worker (`sw.js`) still network-first/cache-fallback; the app is
still mobile-first. `sw.js`'s cache version was bumped (`greenwave-v5`) and
`assets/api.js` added to its precache list so the new script ships
correctly instead of risking a stale-cache mismatch — see the White-Screen
Regression section of `docs/V2_IMPLEMENTATION.md`.
