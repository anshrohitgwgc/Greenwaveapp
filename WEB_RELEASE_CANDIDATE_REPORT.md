# GreenWave V2 — Web Release Candidate Report

Branch: `greenwave-payment-rbac-ui`
Final commit: `8e6d9a9` (test(a11y): individually verify Adjust Stock and Send Invoice modals)
Production baseline: `25f3d57f935b558ebe74af2112ba320a99018a06` — confirmed ancestor of final commit via `git merge-base --is-ancestor`.

This report is the closeout of `FINAL_WEB_QA_REPORT.md`. That report closed every UI QA
item except one named gap: the Adjust Stock and Send Invoice modals shared already-fixed
code paths but had never been individually re-scanned in a real browser. This pass opened
both in the real running app (real Chromium via Playwright, real API/Postgres/Redis/MinIO,
real seeded login) at 390×844, 768×1024, and 1366×768, found and fixed one real defect
(unlabelled Reason/quantity fields in Adjust Stock), and re-ran the full existing
test/lint/build/tsc/e2e matrix to confirm zero regressions. Full detail, including the
defect and its fix, is in the addendum at the top of `FINAL_WEB_QA_REPORT.md`.

---

## Test totals (exact, this pass)

| Command | Result |
|---|---|
| `npm test` | **PASS — 218/218** (137 Jest + 28 unit + 19 security + 34 acceptance) |
| `npm run lint` | **PASS** — 0 errors |
| `npm run build` | **PASS** — API (nest build) + Web (vite build) |
| `npx tsc --noEmit` (run from `backend/app/api`) | **PASS** — 0 errors |
| `npm run test:e2e` | **PASS — 114/114** (85 legacy `tests/e2e-legacy` + 29 `backend/app/web`) |

The legacy e2e count rose from 79 to 85 — the 6 new Adjust Stock / Send Invoice modal tests
added this pass. No other suite changed size or outcome.

## Accessibility

- 22/22 WCAG 2.0/2.1 A+AA axe checks from the prior pass remain green (screens + first-wave
  modals + Public Payment Page), re-confirmed by re-running the full suite.
- Adjust Stock modal and Send Invoice modal: **individually axe-scanned this pass, both
  clean** (Adjust Stock only after the label-association fix below).
- 0 axe violations across the full audit.

## Responsive

- Verified at all three required breakpoints (390×844, 768×1024, 1366×768) for both closed
  modals this pass: no horizontal overflow, modal bounding box stays within the viewport,
  keyboard reachability confirmed at every size.
- Broader 5-breakpoint screenshot/visual coverage (390×844, 430×932, 768×1024, 1366×768,
  1920×1080) exists and is current for HEAD for 6 representative screens: Login, Dashboard,
  Inventory, Invoices (list), Staff (Management Portal), and the public Customer Payment
  Page (`tests/e2e-legacy/specs/responsive-visual-qa.spec.js`, screenshots under
  `test-results/responsive-visual-qa/`), plus a general no-console/network-error render check
  at 5 viewports in `backend/app/web`'s e2e suite (all screens, not screen-by-screen
  screenshots).
- **Gap, reported honestly rather than assumed:** dedicated per-screen screenshots do not
  exist for Inbound, Outbound, History, Materials, Customers, Photos, Time Clock, Chat, or
  the saved Invoice *document* view (as distinct from the Invoices list) — this was the
  existing scope of `responsive-visual-qa.spec.js` before this pass and was not expanded,
  since the named gap for this pass was the two modals, not screenshot breadth. Those 9
  screens are still exercised functionally by other e2e specs (accessibility-audit.spec.js
  scans axe on most of them at default viewport; the `backend/app/web` suite exercises
  Inbound/Outbound, History, Photos, Time Clock, Chat, Customers, Staff functionally) — they
  are just not part of the 5-breakpoint screenshot set.

## Security regression

RBAC, warehouse access, division isolation, material IDOR, customer isolation, photo
authorization, and payment authorization: **all re-run and green** as part of `npm test`'s
218/218 (dedicated 19-test security suite + acceptance matrix covering RBAC/IDOR/webhook
HMAC/replay/idempotency/refund defenses) and the `backend/app/web` e2e warehouse-and-
division-isolation suite (29/29, including warehouse ID tampering → 403, division isolation
per facility, photo authorization by facility). No authorization or business-logic code was
touched this pass — the only production change is accessibility markup
(`id`/`for`/`aria-*`) inside `openAdjustModal()` in `assets/app.js`.

## Invoice

- Document/print view (`renderInvoiceDocumentView()` in `assets/app.js`) verified by source
  inspection this pass to contain **no** `<input>`, `<textarea>`, or `<button>` elements —
  confirmed structurally separate from the editable form (`renderInvoiceEditorForm()`).
- Verified present: logo, Bill To / Ship To, invoice number/date/due date/terms, line items
  with per-item tax, Subtotal, Tax, TOTAL, Payment instructions, Additional notes/memo, and
  payment status badge (with paid-date when applicable).
- Axe-clean (0 violations) on the saved invoice View document (prior pass, re-confirmed this
  pass via full regression re-run).
- Print/PDF branding, Bill/Ship To, line items, and totals independently verified by
  `backend/app/web`'s e2e suite (test #21, green).
- Send Invoice modal (new this pass): opens, focuses, Tab-cycles, Escapes, closes, and
  restores focus correctly at all 3 breakpoints; no Stripe secret-key/PaymentIntent-id
  pattern or internal `data-*-id` attribute found in the modal body/HTML.

## Inventory

- Adjust Stock modal (new this pass): full open/focus/Tab-trap/Shift+Tab/Escape/close-
  button/backdrop/focus-restore/no-horizontal-overflow/label-association verification at all
  3 breakpoints, for both the Recycling (pallet) and Healthcare (box XL/L/M/S) field
  variants. One real defect found (unlabelled Reason + quantity inputs) and fixed.
  No stock adjustment was submitted during testing — the modal was opened, interacted with,
  and closed via Escape/close-button/Cancel only.
- Receive Inbound / Ship Outbound modals and the whole-unit (integer pallet/box) validation
  rules: carried over from the prior pass, re-confirmed green this pass via full regression.

## RBAC

Full `backend/app/api` security + acceptance suites (19 + 34 tests) and the
`backend/app/web` RBAC/warehouse-tampering e2e suite: all green, re-run this pass, unchanged
from the production-baseline-derived state.

## Photos

Upload/store/retrieve/lightbox/download/EXIF-GPS-stripping: carried over from the prior
pass (lightbox focus management and contrast were fixed there), re-confirmed green this
pass via full regression (`image-sanitizer.spec.ts`, `photo-exif-security.e2e-spec.ts`, and
the `backend/app/web` photo-authorization e2e tests).

## Time Clock

Live-timer, page-navigation and reload persistence: carried over, re-confirmed green this
pass (`backend/app/web` e2e test #22).

## Chat

Two real browser contexts over SSE: carried over, re-confirmed green this pass
(`global-chat.spec.js`).

## Customers

Customer CRUD and blank-email/warehouseId handling: carried over, re-confirmed green this
pass (`customers.spec.js`).

## Staff

Staff management, RBAC-gated actions, and audit event recording: carried over, re-confirmed
green this pass (`backend/app/web` e2e test #19; RBAC suite in `npm test`).

## Payment page

Public payment page opened via a real generated invoice + real payment token, in a fresh
incognito browser context: axe-clean, no admin session token in `sessionStorage`, no `#nav`
chrome, no admin email string in the page — carried over from the prior pass, re-confirmed
green this pass via full regression re-run.

---

## Stripe

**BLOCKED — BUSINESS ACCOUNT SETUP PENDING.** No live Stripe credentials exist in any env
file in this repo; checkout remains sandbox/test-mode. Not configured, not touched, not
worked around this pass, per instruction.

## Production

**NOT DEPLOYED.**

## Git

- Stayed on `greenwave-payment-rbac-ui` throughout. No merge, push, or deploy performed.
- One commit this pass: `8e6d9a9` — `test(a11y): individually verify Adjust Stock and Send
  Invoice modals`.
- `backend/app/web/playwright-report/index.html` (a pre-existing tracked generated report
  file) changed again from running the suite; left unstaged, not committed, matching prior-
  pass handling.
- No `.env`, credentials, Stripe secrets, or screenshots were committed.

---

# WEB APPLICATION: FINAL QA PASS

**PRODUCTION: NOT DEPLOYED**
