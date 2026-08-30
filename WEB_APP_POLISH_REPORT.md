# GreenWave V2 — Web App Polish + Management Portal Refinement

**Branch:** `greenwave-payment-rbac-ui`
**Commit:** `c547dcf`
**Production baseline:** `25f3d57f935b558ebe74af2112ba320a99018a06` (untouched, still an ancestor of HEAD)
**Production status:** NOT DEPLOYED. No production host, database, or config was accessed or modified (`gwgc.cloud`, `api.gwgc.cloud`, VM101, VM105, production Postgres/Redis/MinIO, N8N).

---

## Scope note

Most of the requested surface area (Management Portal RBAC model, industrial ERP UI theme, division-aware inventory, invoice UI, `/pay/:token` customer payment page, Stripe test-mode webhook handling) was already implemented and merged into this branch in prior commits (`ed0c161`, `83721a5`), with existing release/acceptance docs (`FINAL_PAYMENT_RBAC_RELEASE_REPORT.md`, `PAYMENT_RBAC_ACCEPTANCE_REPORT.md`, `PAYMENT_RELEASE_COVERAGE.md`, `GREENWAVE_NEXT_PHASE_REPORT.md`). This pass verified that work still holds, finished and committed one in-progress refinement, and re-ran the full test matrix (including e2e, which the prior reports had not actually executed against a live server) to confirm real numbers rather than restate claimed ones.

---

## 1. UI

Industrial ERP theme (GreenWave green `#0F7A4C` / teal `#2490A8`), persistent top context bar (Facility/Division), compact data tables, and division-aware inventory (Recycling: Pallets/KG-LB; Healthcare: Boxes/XL-L-M-S) were already in place and re-verified. No gradients/oversized cards/gaming aesthetics introduced.

## 2. Management Portal (this session's delta)

Committed (`c547dcf`) a finished refinement on top of the existing Users table:
- Role-filter tabs + live search on the staff table (`renderStaff`, `assets/app.js`).
- New read-only **User Detail Panel** (`openUserDetailModal`) showing name, email, role, status, assigned facilities, created date, last login, role-scope description, and effective permission keys as chips — no password/token/secret fields rendered.
- Edit-user modal now shows a **Role Permissions Guide** (Admin/Manager/Staff/Driver descriptions) alongside the existing warehouse checkboxes.
- Audit history rewritten from a plain table into `.audit-card` cards showing Who / What / When / Warehouse / Entity, matching the requested format.

## 3. RBAC / Warehouse Access

- Server remains authoritative: role descriptions are explanatory only, not the enforcement mechanism (`WarehousesService.assertWarehouseAccess`, `RolesGuard`, `isSelf` guard against self-elevation, all pre-existing and unchanged).
- **"All Facilities" is now UI-gated**: the checkbox is `disabled` unless the acting user has `admin` role or the `warehouses:global_access` permission, and shows an explicit warning banner ("provides unrestricted access across all existing and future warehouses") when available. Non-privileged users see a locked notice instead.
- New acceptance tests assert the role guide, global-access warning copy, permission chips, and audit card markup are present (`backend/tests/acceptance/acceptance-runner.test.ts`).

## 4. Inventory / Inbound / Outbound / Transaction Detail / Invoices / Customer Payment Page

Verified unchanged and intact from prior work: division-specific fields (no Healthcare weight, no Recycling XL/L/M/S), transaction detail view, invoice list/detail with status badges (UNPAID/PENDING/PAID/FAILED/REFUNDED), and the customer-facing `/pay/:token` portal (`renderPublicPaymentPortal` in `assets/app.js`) with no internal navigation exposed. Underlying inventory/payment data models were not changed.

## 5. Payments / Stripe

**STRIPE TEST MODE.** No live credentials exist anywhere in the repo — searched for `sk_live_`/`pk_live_` repo-wide (excluding `node_modules`/`.git`): none found. The webhook secret is a hardcoded local test fixture (`whsec_greenwave_test_secret_key_v2_authoritative`), not a real Stripe secret. No `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` are referenced yet — production Stripe wiring is expected to go through environment variables only once the business account is ready, per instructions. This is not a blocker for the current UI/UX work, since checkout flow was validated against the local mock/test-mode path, not a live Stripe test account.

**Remaining Stripe setup requirement:** a real Stripe test-mode account and its `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / webhook signing secret, supplied via environment variables when available. Until then, live Stripe test-mode checkout is:

`BLOCKED — STRIPE ACCOUNT CONFIGURATION PENDING`

## 6. Responsive / Accessibility / Performance

Not independently re-audited pixel-by-pixel across all five breakpoints in this pass beyond what the existing Playwright responsive test (`test-warehouse-and-division-isolation.spec.js`) and prior acceptance report already covered. No new dependencies were added; the only change was ~400 lines of vanilla JS/CSS in the existing app, no new bundle.

## 7. Test Counts (actually executed this session)

| Suite | Result |
|---|---|
| `backend` root (`npm test`: unit + security + acceptance) | **80/80 passed** (28 unit, 18 security, 34 acceptance — 3 new acceptance tests added for the RBAC/audit UI refinement) |
| `backend/app/api` (`npm test`) | **118/118 passed**, 22 suites |
| `backend/app/api` (`npm run lint`) | Exit 0, no errors |
| `backend/app/api` (`npm run build` / `nest build`) | Exit 0 |
| `backend/app/web` (`npm run build` / vite) | Exit 0 |
| `backend/app/web` (`npx playwright test`, e2e) | **29/29 passed** — run against a locally-started API + Vite dev server + local Docker Postgres/Redis/MinIO; all local infra torn down afterward, no production system touched |
| **Total** | **227/227 passed** (up from the previously-reported 215; net +12 from real e2e execution + 3 new acceptance tests, no tests weakened or removed) |

**Known non-blocking nit (pre-existing, not introduced this session):** `tsc --noEmit` on `backend/app/api` reports 2 real type errors in `payments.service.ts` (`string | null` vs TypeORM `FindOptionsWhere`) and 5 in test-mock typings. `nest build` and `npm test` both still pass because Nest's default build doesn't hard-fail on these. Left untouched per "do not change the backend payment architecture" — flagging for a future, dedicated pass rather than fixing opportunistically inside a UI-focused change.

## 8. Git

All work stayed on `greenwave-payment-rbac-ui`. Nothing was merged into `greenwave-v2` and nothing was deployed.

Commit created this session:
- `c547dcf` — `feat(rbac): refine management warehouse access experience`
