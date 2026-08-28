# GreenWave V2 Implementation Status — Frontend

Full backend status lives in `docs/V2_STAGING_REPORT.md` in the
`FULL-INFRA-V.0001-main` repo (branch `greenwave-v2`). This is the
frontend-only summary.

## Done — Gate 1 (this pass)

- Every remaining view wired to the real API, replacing direct
  `db.*`/`Store` reads with a `Sync` read-through layer
  (`assets/app.js`) that fetches on view entry and maps API responses into
  the exact local shapes the existing render functions already expected —
  so none of the render functions themselves needed rewriting:
  **Invoices** (create/update/duplicate, server-assigned sequential
  numbers), **Inventory/Weigh-in** (inbound/outbound tickets,
  warehouse-scoped balances), **Photos** (client-side resize/EXIF-strip
  unchanged, now uploads to `/photos`/MinIO instead of IndexedDB;
  thumbnails and lightbox load via presigned URLs), **Time clock**
  (clock-in/out against the server, with 409 surfaced honestly on a race
  rather than silently overwritten), **Customers**, **Materials**,
  **Warehouses**, **Staff** (now creates real accounts via `POST /users`),
  **History** (real audit trail via `GET /audit`).
- `assets/api.js` gained `uploadPhoto`/`getPhotoUrl`/`deletePhoto`
  (multipart — the JSON-only `request()` helper can't carry a `File`),
  `createCustomer`, `createMaterial`.
- `assets/photos.js` exposes `shrink()` (the existing downscale/EXIF-strip
  step) so `app.js` can reuse it ahead of a server upload instead of an
  IndexedDB write.
- Service worker cache bumped to `greenwave-v6`.

## Known limitations (not fixed in this pass — see the backend's staging report §11 for why)

- Materials have no server-side "default rate" column — that field is
  dropped for server-sourced materials (shows "—").
- Staff deactivate/reactivate and customer/material delete have no backend
  endpoints yet — those controls were removed from the UI rather than left
  as fake local-only actions that would resurrect on reload.
- The inventory ticket list's "By" column shows "—" for server-sourced
  tickets (the API returns a numeric `postedBy`, not a name, and this pass
  didn't add a lookup for it).

## Testing

- `node --check` passed on all five script files (syntax only).
- **Real browser QA performed** — Playwright + Chromium against the actual
  staging backend (Postgres/Redis/MinIO, all real, no mocks), at all five
  required viewports (1920×1080 / 1440×900 / 1280×720 / 390×844 / 430×932):
  no blank screen, no console errors, no failed requests, no horizontal
  overflow, every nav view reachable including the off-canvas mobile menu.
  A separate interactive run drove real clicks/fills through sign-in, add
  customer, create invoice, upload photo, clock in — all persisted and
  visible without a reload, zero console errors. PWA fresh-install and a
  genuine (not simulated) old-version-to-new-version upgrade were also
  verified. Full detail in the backend repo's `docs/V2_STAGING_REPORT.md`.
- No JS unit-test framework exists in this repo (it's intentionally a
  no-build-step, plain-script app). Automated coverage lives in the
  backend's test suite plus the live functional/security tests described
  in the staging report.
