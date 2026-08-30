# FINAL E2E ACCEPTANCE TEST REPORT — GREENWAVE V2

## Executive Summary

The GreenWave V2 end-to-end (E2E) acceptance test suite was executed against the isolated local environment (`http://127.0.0.1:5173`, NestJS API on `http://127.0.0.1:4000`, local PostgreSQL 16, local Redis 7, and local MinIO S3 object storage).

All 27 comprehensive test scenarios executed and passed with 0 failures and 0 skipped tests.

---

## Test Execution Metrics

| Metric | Value |
|---|---|
| **Playwright Version** | `1.62.1` |
| **Previous Test Count** | `21` |
| **New Total Test Count** | `27` |
| **Passed** | `27` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total Duration** | `1.2m (72s)` |
| **Backend Unit Tests** | `104 passed (20 suites)` |
| **Target Frontend** | `http://127.0.0.1:5173` |
| **Target API** | `http://127.0.0.1:4000` |

---

## Acceptance Verification Breakdown (API vs UI)

| Requirement / Module | Verification Layer | Status | Evidence & Test Details |
|---|---|---|---|
| **AUTH: Login** | UI & API | **UI VERIFIED** | Valid credentials submit via UI (`#email`, `#password`) → authenticated navigation to `/dashboard`. |
| **AUTH: Logout** | UI & API | **UI VERIFIED** | `Log Out` button clears browser session and redirects to `/login`. |
| **AUTH: Invalid Login** | UI | **UI VERIFIED** | `.alert-error` appears with error message; navigation blocked. |
| **AUTH: Signup Absent** | UI & API | **UI & API VERIFIED** | Public registration disabled (`403 Forbidden`); 0 signup/register DOM elements. |
| **WAREHOUSE ACCESS: Single Facility** | API | **API VERIFIED** | Staff Calgary restricted to `CGY`; Ontario balance returns `403`. |
| **WAREHOUSE ACCESS: Multi Facility** | API | **API VERIFIED** | Manager accesses `[CGY, MR]`; Ontario returns `403`. |
| **FACILITY SELECTOR: Staff Calgary** | UI (DOM) | **UI VERIFIED** | Dropdown contains only `Calgary, AB`; does NOT contain `Ontario` or `Maple Ridge, BC`; no duplicates. |
| **FACILITY SELECTOR: Manager** | UI (DOM) | **UI VERIFIED** | Dropdown contains `Calgary, AB` and `Maple Ridge, BC`; does NOT contain `Ontario`; no duplicates. |
| **SERVER-SIDE 403 / TAMPERING** | API (HTTP) | **API VERIFIED** | Direct tampering across transactions, containers, photos, and time clock returns real HTTP `403`. |
| **DIVISION ISOLATION: Calgary** | API & DB | **API VERIFIED** | Calgary Recycling & Healthcare isolated across ledger and balances. |
| **DIVISION ISOLATION: Ontario** | API & DB | **API VERIFIED** | Ontario Recycling & Healthcare isolated across ledger and balances. |
| **DIVISION ISOLATION: Maple Ridge** | API & DB | **API VERIFIED** | Maple Ridge Recycling & Healthcare isolated across ledger and balances. |
| **DIVISION CONDITIONAL UI** | UI (DOM) | **UI VERIFIED** | Recycling shows Pallet Qty, Weight, KG/LB and hides XL/L/M/S; Healthcare shows XL/L/M/S and hides Weight/KG/LB; switching clears fields and prevents stale value leakage. |
| **INTEGER UNITS: Recycling Pallets** | API & Validation | **API VERIFIED** | Whole pallet quantities (1, 2, 6) valid; fractional (1.5, 0.12) and negative rejected (`400 Bad Request`). |
| **INTEGER UNITS: Healthcare Boxes** | API & Validation | **API VERIFIED** | Whole box counts (1, 100) valid; fractional (1.5, 0.12) and negative rejected (`400 Bad Request`). |
| **FRACTIONAL WEIGHT: Recycling** | API & Validation | **API VERIFIED** | Fractional weight (e.g. `1250.5 KG`) accepted and stored accurately. |
| **PHOTO UPLOAD & SCOPING** | API & S3 Storage | **API VERIFIED** | Binary photo uploaded to MinIO bucket; authorized queries succeed (`200`), unauthorized queries blocked (`403`). |
| **PHOTO LIGHTBOX** | UI (Browser Modal) | **UI VERIFIED** | Clicking thumbnail opens modal with image & metadata; closes via close button, Escape key, and backdrop click; reload persistence verified. |
| **STAFF MANAGEMENT & AUDIT** | API & DB | **API VERIFIED** | Facility access assignment & revocation generates persistent `user.warehouse_access_updated` database audit records. |
| **INVOICE MANAGEMENT** | API & DB | **API VERIFIED** | Sequential invoice creation, lookup, and patching verified. |
| **INVOICE PRINT / PDF** | UI (Browser Layout) | **UI VERIFIED** | Printable invoice sheet rendered with GreenWave branding, Bill To, Ship To, shipping info, line items, subtotal, GST (5%), and total; `window.print()` trigger verified. |
| **TIME CLOCK: Live Ticker** | UI (Browser Real-Time) | **UI VERIFIED** | Staff clocks in; live duration timer ticks and increases (+3s); timer persists across page navigation (`/dashboard` & `/timesheets`) and browser reload; double-click guard prevents duplicates; clock out records duration in history. |
| **RESPONSIVE UI (390x844)** | UI (Mobile Small) | **UI VERIFIED** | Clean rendering, responsive layout, zero UI breakage. |
| **RESPONSIVE UI (430x932)** | UI (Mobile Large) | **UI VERIFIED** | Clean rendering, responsive layout, zero UI breakage. |
| **RESPONSIVE UI (768x1024)** | UI (Tablet Portrait) | **UI VERIFIED** | Clean rendering, responsive layout, zero UI breakage. |
| **RESPONSIVE UI (1366x768)** | UI (Laptop) | **UI VERIFIED** | Clean rendering, responsive layout, zero UI breakage. |
| **RESPONSIVE UI (1920x1080)** | UI (Desktop) | **UI VERIFIED** | Clean rendering, responsive layout, zero UI breakage. |
| **CONSOLE ERRORS** | UI Monitoring | **UI VERIFIED** | 0 unexpected console errors or unhandled promise rejections. |
| **NETWORK ERRORS** | UI Monitoring | **UI VERIFIED** | 0 unexpected network failures across all browser scenarios. |
| **BRANDING LOGO** | Visual Asset | **BLOCKED / NOT TESTED** | User-supplied high-resolution logo asset remains unavailable in repository. Fallback text/Unicode glyph (`♻ GreenWave`) active. |

---

## Production Safety Verification

- **Production URLs untouched**: No traffic or connection attempts made to `gwgc.cloud`, `api.gwgc.cloud`, `192.168.1.x`, VM105, Management Portal, or N8N.
- **Secrets protected**: No environment secrets or passwords exposed.
- **Strictly isolated local loopback**: PostgreSQL, Redis, MinIO, NestJS API, and Vite React SPA.
