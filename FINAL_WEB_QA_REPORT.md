# GreenWave V2 — Final Web Closeout QA Report

Branch: `greenwave-payment-rbac-ui`
HEAD at start of this pass: `45af737` (docs: add web perfection pass final report)
Production baseline: `25f3d57f935b558ebe74af2112ba320a99018a06` (ancestor of HEAD — confirmed via `git merge-base --is-ancestor`)

This pass picks up exactly where `WEB_PERFECTION_FINAL_REPORT.md` left off. That report's own "Not independently re-verified" section named one open gap: *"Full manual keyboard-tab-order audit and color-contrast measurement across every screen ... not exhaustive against every modal."* This pass closes that gap with a real, automated, evidence-producing accessibility audit (axe-core driven through actual Chromium via Playwright, against the live app on the real API/Postgres/Redis/MinIO stack — the same method the prior pass used), fixes every real defect it found, adds a lightweight real-network performance check, and re-runs the entire existing test/security/e2e matrix to confirm nothing regressed.

Per the closeout instructions, work already fixed in the prior pass (photo URL/storage, photo size calc, fake-payment placeholder removal, invoice address, photo a11y/lightbox basics, SKU removal, warehouse/division isolation, material IDOR, inventory/history restructuring, mobile nav) was **not** re-done — only verified via the full regression re-run below.

---

## Method

1. Located the real running stack: Postgres/Redis/MinIO in Docker (already up), NestJS API on `:4000`, static frontend on `:8080` — none of it started or reconfigured by this pass.
2. Ran the full existing test/lint/build/tsc/e2e matrix first to get a real, current baseline (confirmed identical to the prior report: 218/218, lint/build/tsc clean, 77/77 e2e) — proof this pass started from a genuinely clean, unregressed state.
3. Installed `@axe-core/playwright` (WCAG 2.0/2.1 A+AA ruleset) and wrote `tests/e2e-legacy/specs/accessibility-audit.spec.js`: a real-browser audit that logs in as an actual seeded user and axe-scans every required screen, both inventory divisions (Recycling *and* Healthcare — the app has a division-scoped color-token override, so both had to be scanned independently), every major modal (Add Customer, Add Material, Create Staff, Receive Inbound, Ship Outbound, Payment Link, Photo Lightbox), the saved-invoice View document, and the real public Payment Page opened via a **freshly generated real invoice + real payment token**, in a brand-new incognito browser context.
4. The same spec drives real keyboard interaction per dialog: Tab is pressed through every focusable element and asserted to stay inside the dialog (no leaked focus), Escape is asserted to close it, and focus is asserted to land back on the exact control that opened it.
5. Every violation axe reported was investigated to its root cause in the real source (not suppressed or worked around) and fixed. Re-scanned after each fix until 22/22 accessibility+modal tests passed clean.
6. Added `tests/e2e-legacy/specs/perf-duplicate-requests.spec.js`: a real-network check (Playwright request listener against the actual API) asserting no GET endpoint is fetched more than once on first load, across 9 screens.
7. Re-ran the entire test/lint/build/tsc/e2e matrix (including the two new spec files) to confirm zero regressions from the fixes.

---

## Real defects found and fixed (this pass)

| # | Area | Defect | Root cause | Fix |
|---|------|--------|------------|-----|
| 1 | Every modal (`#modalWrap`) | Opening a modal did not move focus into it, did not trap Tab inside it (a sighted keyboard user could Tab straight through into the page behind the still-open dialog), and closing it did not return focus to the control that opened it. | `openModal()` had no focus management at all — it only toggled `hidden`. | Added `dialogOpenerEl` tracking, initial focus into the first field (or the close button) on open, a shared `trapFocus()` Tab-cycle handler wired into the existing global keydown listener, and focus restoration to the opener on close. |
| 2 | Photo Lightbox | Same three defects as #1 — no initial focus, no Tab trap, no focus restoration — plus it had no `role="dialog"`/`aria-modal`/accessible name at all. | `openLightbox()`/close handlers only toggled `hidden`; the lightbox predates the modal's `role="dialog"` markup. | Added `role="dialog" aria-modal="true" aria-label="Photo viewer"`; added a `closeLightbox()` helper doing the same open/close focus management as the modal, wired to the close button, Escape, and the delete-photo success path; Tab now traps inside it via the same shared handler. |
| 3 | Login form | An invalid-login error was inserted into the DOM with no `role="alert"`/`aria-live` — a screen-reader user got no announcement that sign-in failed. | `gateError()` built plain markup with no live-region semantics. | Added `role="alert"` to the `.gateerr` element. |
| 4 | Every form built via the shared `field()` helper (Add Customer, Add Material/Product, Settings company fields, Create Staff, etc.) | `<label>` text was rendered but never programmatically associated with its input — no `for`/`id` pair, no wrapping. Screen readers had no reliable way to announce what a focused field was for. | `field()` never generated or referenced an `id`. | Added `id="f-<name>"` to the generated control and `for="f-<name>"` on its `<label>`. One fix in the shared helper closes this for every form built with it. |
| 5 | Receive Inbound / Ship Outbound modals (Recycling & Healthcare, both directions — 4 near-duplicate hand-built forms) | "Warehouse Location" (readonly) and "Date" inputs, and the "Material"/"Product" `<select>`, had visible `<label>` text with the same disconnected-label bug as #4 (these forms predate `field()` and build their own markup); the weight-unit `<select>` (KG/LB) had no label or accessible name at all. | Hand-rolled form markup, not using the shared helper. | Added matching `id`/`for` pairs for the location/date/material fields (all 4 duplicated form blocks fixed identically) and `aria-label="Weight unit"` on the unit select. |
| 6 | Payment Link modal | The read-only "shareable link" text input had no label — it sits under a `<p>` description, not a `<label>`. | Hand-built modal body string. | Added `aria-label="Payment link URL"`. |
| 7 | Sidebar nav section headers (`.navlabel`, e.g. "OPERATIONS" / "MANAGEMENT") | Text rendered at 4.39:1 contrast against the dark rail background — under the 4.5:1 AA minimum for small text. | `opacity: 0.75` was layered on top of an already-legible token (`--rail-ink`, ~6.9:1 at full opacity), washing it out below threshold. | Removed the `opacity: 0.75`. |
| 8 | Login subtext, password-visibility toggle, footer text (`--muted` token, used site-wide) | 4.06–4.39:1 contrast against white/near-white panels — under 4.5:1. | `--muted: #668078` was measured (not assumed) to be under AA at its actual normal-text size. | Darkened the single token to `#5A7069` (~5:1+ against both `--panel` and `--panel-2`). One token change fixes every secondary-text usage site-wide; re-verified via the full-screen axe sweep that nothing else regressed. |
| 9 | `#btnShipStock` button; invoice-document logo subtitle (`.inv-1114-logo-sub`); Healthcare-division `--acc` accent (buttons, active states, and the accent-tinted table columns e.g. XL/L/M/S counts); `.chat-avatar.role-manager` | White text on `#2490A8` teal was 3.73:1 (under 4.5:1); the same teal used as *text* on its own soft background (`--acc-soft`) was 4.32:1. The Healthcare-division color-token override (`[data-entity="healthcare"] { --acc: #2490A8 }`) meant this affected the *entire* Healthcare UI's primary accent, not just one button — only caught because this pass explicitly re-scanned both divisions, not just the default Recycling one. | Brand teal was simply too light for AA at these sizes/usages, in both directions (text-on-teal and teal-on-tint). | Darkened `--teal` and the Healthcare `--acc`/`--acc-hover` override to `#146A80` (verified ≥4.5:1 both as white-on-teal and as teal-text-on-`--acc-soft`), and the one duplicate hardcoded hex in the invoice template and chat avatar to match. |
| 10 | Main content scroll region (`#scroll`); Chat message list (`#chatMessagesWrap`); every horizontally-scrollable table wrapper (`.tablewrap`, 11 render sites: Dashboard activity, Inventory balances/containers, History, Time Clock, Invoices, Materials, Staff) | Scrollable regions with no focusable content inside them are unreachable by keyboard-only users (no way to scroll via arrow keys). | No `tabindex`/`role`/`aria-label` on any scroll container. | Added `tabindex="0" role="region" aria-label="..."` to all of them. |

All ten were reproduced live via axe/keyboard assertions before the fix and re-verified live (re-scanned, zero violations) after.

## Screens and modals scanned (WCAG 2.0/2.1 A+AA, real axe-core, real login, real data)

Login, Login error state, Dashboard (Recycling + Healthcare), Inventory/Stock (Recycling + Healthcare), History, Materials, Customers, Staff, Photos, Time Clock, Chat, Invoices list, Saved Invoice View document, Settings, Receive Inbound modal, Ship Outbound modal, Add Customer modal, Add Material modal, Create Staff modal, Payment Link modal, Photo Lightbox, and the real Public Payment Page (opened via a real generated invoice + real token, in a fresh incognito context). **22/22 pass, zero violations.**

## Not exhaustively covered by this pass

- Automated axe scanning covers structural a11y (labels, roles, contrast, focus) reliably; it does not replace a screen-reader-software (NVDA/VoiceOver) listening pass. None was performed — no screen reader software is available in this environment.
- The Adjust Stock modal, Send Invoice modal, and Duplicate-invoice flow were not independently axe-scanned (only the four highest-traffic modals plus Payment Link and the Lightbox were). They share the same `field()`/`openModal()` code paths already fixed and scanned elsewhere, so the fixes apply to them too, but they were not each individually re-scanned — **NOT TESTED** (not FAIL; no reason to expect a different result, but no direct evidence was collected).
- Print/PDF-specific rendering (as opposed to the on-screen View document, which *was* scanned) was not run through axe, since axe operates on the live DOM, not the print-media/PDF render path.

---

## Per-item results

| Area | Result | Evidence |
|---|---|---|
| Accessibility (screens) | **PASS** | 15 screens × axe WCAG2A/AA+2.1, 0 violations after fixes (see table above) |
| Accessibility (modals) | **PASS** | 6 modals + lightbox, axe scan + real keyboard Tab-trap/Escape/focus-restore assertions, 0 violations/failures |
| Modal QA (open/focus/keyboard/close/restore/backdrop) | **PASS** | `accessibility-audit.spec.js` modal-QA suite, 4 dedicated tests, all green |
| Public Payment Page (real invoice/token) | **PASS** | Opened via a real invoice's real "Get payment link" flow in a fresh incognito context; axe-clean; contains no admin session token, no `#nav`, no admin email string |
| Payment portal security (random/invalid token denied, no internal IDs/staff metadata/nav on public page) | **PASS** | Same test asserts `sessionStorage` token absent and `#nav` hidden on the public route; random/invalid-token 403 behavior covered by existing `backend/app/api` warehouse/payment authorization suite (re-run, green) — not re-derived this pass since unchanged |
| Invoice (Edit/View/Print/PDF) | **PASS** (View re-verified this pass; Edit/Print/PDF carried over unchanged from prior pass, re-confirmed via existing `invoice-document-mode.spec.js` + `backend/app/web` invoice e2e, both re-run green) | axe scan of View document, 0 violations; existing print/PDF branding+totals e2e green |
| Inventory (Recycling + Healthcare workflows, whole-unit validation) | **PASS** (carried over, re-run) | `inventory-inbound-outbound.spec.js` + `backend/app/web` integer-unit tests, all green; both division modals now also axe-clean |
| Division product isolation | **PASS** (carried over, re-run) | `product-division-isolation.spec.js` + `backend/app/web` division-isolation suite, green |
| History | **PASS** (carried over, re-run; scrollable-table fix applied) | `history-transaction-detail.spec.js` green; axe-clean after table/select fixes |
| Photos (upload/store/retrieve/lightbox/download/EXIF-GPS stripping) | **PASS** (carried over, re-run; lightbox focus/contrast fixed this pass) | `image-sanitizer.spec.ts` + `photo-exif-security.e2e-spec.ts` (part of the 218), green; lightbox axe-clean |
| Time Clock | **PASS** (carried over, re-run) | `backend/app/web` live-timer/reload-persistence e2e, green |
| Chat (two real browser contexts, SSE) | **PASS** (carried over, re-run) | `global-chat.spec.js`, green |
| Customers | **PASS** (carried over, re-run) | `customers.spec.js`, green |
| Staff/RBAC | **PASS** (carried over, re-run) | `backend/app/web` RBAC/warehouse-tampering suite, green |
| Dashboard (facility/division shown, no GST/DB internals) | **PASS** | Re-checked `renderDashboard()` source directly this pass — no GST/Postgres/SQL string anywhere in it; axe-clean in both divisions |
| Responsive (5 breakpoints) | **PASS** (carried over, re-run) | `responsive-visual-qa.spec.js` (48 assertions) + `backend/app/web` responsive suite, both green |
| Performance (duplicate/unnecessary requests) | **PASS** | New `perf-duplicate-requests.spec.js`: real network listener, 9 screens, 0 duplicate GET endpoints on first load |
| Performance (slow transitions/large assets) | **NOT TESTED** | No load-time budget or asset-size regression tooling exists in this repo; not fabricated |
| Security regression (RBAC/warehouse/division/material IDOR/customer/photo/invoice/payment authorization) | **PASS** | Full `npm test` (218/218, includes the dedicated security suite) + both e2e suites re-run after every fix in this pass — no backend/authorization code was touched |
| Stripe | **BLOCKED — STRIPE BUSINESS ACCOUNT SETUP PENDING** | Unchanged this pass; no live credentials in any env file; checkout remains sandbox/test-mode |

---

## Test / Lint / Build / TSC / E2E — exact numbers (all commands actually run this pass)

```
npm test         → PASS  — 218/218 (Jest 137, unit 28, security 19, acceptance 34), exit 0
npm run lint      → PASS  — eslint --fix, 0 remaining errors, exit 0
npm run build     → PASS  — API (nest build) + Web (vite build), exit 0
npx tsc --noEmit  → PASS  — backend/app/api: 0 errors, exit 0
npm run test:e2e  → PASS  — 79/79 (legacy frontend, tests/e2e-legacy — 48 pre-existing + 22 new accessibility/modal + 9 new perf)
                             + 29/29 (backend/app/web)
                             = 108/108, exit 0
```

---

## Security

No RBAC, warehouse-authorization, division-isolation, material-authorization, customer-isolation, photo-authorization, invoice-authorization, or payment-authorization code was touched this pass. All changes were: focus-management JS in the shared modal/lightbox open/close paths, CSS color-token values, and `id`/`for`/`aria-label`/`role`/`tabindex` markup additions — none of which affect any server-side authorization check. The full backend security suite (19 dedicated tests) plus both warehouse-tampering/division-isolation e2e suites were re-run after every change in this pass and stayed green throughout.

## Git

- Stayed on `greenwave-payment-rbac-ui` throughout. No merge, push, or deploy.
- Commits made this pass (see `git log`):
  - `fix(a11y): modal/lightbox focus management, contrast tokens, form labels, scrollable regions`
  - `test(a11y): add automated axe accessibility audit, modal QA, and duplicate-request perf checks`
- `backend/app/web/playwright-report/index.html` (a pre-existing tracked generated report file, same as noted in the prior pass) changed again from running the suite; left unstaged, not committed, matching prior-pass handling.
- No `.env`, credentials, Stripe secrets, or screenshots were committed.

---

**PRODUCTION: NOT DEPLOYED**
