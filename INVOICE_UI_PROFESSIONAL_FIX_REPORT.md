# Invoice UI Professional Fix Report

Branch: `greenwave-payment-rbac-ui`
Base commit: `e804508`

## Problem Identified

The invoice document (the vanilla-JS operations frontend at the repo root —
`index.html` / `assets/app.js` / `assets/app.css`) rendered every saved
invoice through the same function used to build the create/edit form
(`renderEditor()`), so a "saved" invoice always displayed as a raw web
form: bordered `<textarea>` boxes for payment instructions and notes,
concatenated/misaligned totals, and no separation between application
controls and the document itself.

Root cause of the visual mess: `renderEditor()`'s bottom section
(`.inv-1114-bottom-grid`, `.inv-1114-instructions-area`,
`.inv-1114-totals-col`, `.inv-1114-totals-row`, `.inv-1114-total-due-row`,
`.inv-1114-actions-bar`) referenced CSS classes that **did not exist** in
`assets/app.css` — the stylesheet still had an older, differently-named set
of rules (`.inv-1114-footer-grid`, `.inv-1114-pay-title`, `.pay-badge`,
`.inv-1114-totals-block`, `.inv-1114-total-row`) left over from an earlier
iteration and never used by any markup. With no matching CSS, the browser
fell back to default form-control rendering for the textareas and
default block layout for the totals — exactly the "editable web form"
look in the screenshot.

A secondary, pre-existing data bug was also found during visual QA:
`assets/store.js`'s default company settings stored the GST field as
`'GST/HST Registration No. 751161951RT0001'` — baking the label into the
value — which showed the label twice once a proper "GST/HST Registration
No." caption was added to the document header.

## Changes Made

- **`assets/app.js`**
  - Split invoice rendering into two functions sharing one `draft` object:
    - `renderInvoiceDocumentView()` — read-only, print-ready invoice
      (no inputs/textareas). Used whenever a saved invoice is opened via
      "View".
    - `renderInvoiceEditorForm()` — the original input/textarea form,
      used only for creating a new invoice or explicitly editing an
      existing one.
  - `renderEditor()` is now a small dispatcher (`editorViewMode` flag)
    that picks one of the two, sets the document title
    (`Invoice #123` vs `Edit Invoice #123` vs `New Invoice`), and wires
    the action bar.
  - Added a payment-status badge (`PAID` / `PAYMENT PENDING` /
    `PAYMENT FAILED` / `REFUNDED` / `PAYMENT DUE`) plus a
    `Paid on: DD/MM/YYYY` line when paid, sourced from the existing
    `paymentStatus` / `paidAt` invoice fields (now carried through
    `invoiceToDraft`).
  - Extracted the payment-link and send-invoice modal logic out of the
    invoice list into reusable `showPaymentLinkModal()` /
    `showSendInvoiceModal()` functions, and wired new **Payment Link** /
    **Send Invoice** buttons into the invoice view's action bar (only
    shown for a saved invoice in view mode) alongside the existing
    **Print / PDF** and a mode-aware **Save Invoice** / **Edit Invoice**
    button.
  - Removed the redundant, unstyled in-document action bar
    (`.inv-1114-actions-bar` with duplicate Print/Save buttons) — all
    editor controls now live in the `.vhead` bar outside the document,
    never inside the printable sheet.
  - Fixed a minor label typo ("Unit." → "Unit").
  - No changes to tax/rebate calculation (`totalsLocal`,
    `lineAmountDollars`), invoice numbering, payment/Stripe logic, or
    API payloads.

- **`assets/app.css`**
  - Replaced the orphaned, unused rule set with CSS that actually
    matches the markup: `.inv-1114-bottom-grid`,
    `.inv-1114-instructions-area` / `.inv-doc-text-block` (shared class
    list so the textarea and its read-only counterpart render
    identically as document text), `.inv-1114-totals-col`,
    `.inv-1114-totals-row`, `.inv-1114-total-due-row` (bold, green,
    top-ruled — visually dominant), and a new `.inv-1114-footer`.
  - Added read-only "document mode" styles (`.inv-doc-text`,
    `.inv-doc-address`, `.inv-doc-tax`, `.inv-doc-paid-date`,
    `.inv-doc-muted`) so company/address/meta fields render as plain
    text, never as bare inputs, in view mode.
  - Added a responsive block (placed after the base `.inv-1114-*` rules
    so it wins the cascade) that stacks the header/banner/meta/bottom
    grids to a single column under 768px, and lets the line-item table
    scroll horizontally via its existing `overflow-x: auto` wrapper
    instead of squeezing.
  - Hardened the print stylesheet: `.invoice-page-1114 input/textarea`
    are forced borderless/backgroundless/no-resize/no-padding in print,
    and `break-inside: avoid` was added to the document container and
    table wrapper to reduce awkward page breaks. This means even if
    someone prints while still in edit mode, no form chrome reaches
    paper/PDF.

- **`assets/store.js`**
  - Fixed the default company GST value from
    `'GST/HST Registration No. 751161951RT0001'` to `'751161951RT0001'`
    (a one-line data-default fix, not a schema/logic change) so the new
    document header's "GST/HST Registration No." caption doesn't get
    duplicated by the value underneath it.

- **`index.html`**
  - Added `#edPayLink` / `#edSendInv` buttons (hidden by default) to the
    invoice view's action bar.
  - Added an `i-edit` (pencil) icon to the SVG sprite for the "Edit
    Invoice" button.

## Editor Mode

Unchanged in substance: free-text inputs and textareas for every field,
the same `Add Line` / delete-line / save behavior, the same
`createInvoice` / `updateInvoice` payload shape. Only the layout/spacing
around it changed (fixed via the CSS corrections above), and the
duplicate bottom action buttons were removed since the top action bar
already covers Print/Save.

## Document Mode

New. Every field renders as plain text with document-appropriate
typography: address blocks, a two-column shipping/invoice-details
block (with a payment-status badge), a plain data table, payment
instructions and notes as plain paragraphs under document-style
headings, and a right-aligned, bold TOTAL row. This is what "View" now
opens, and what prints/exports to PDF.

## Print Mode / PDF Mode

Verified via Playwright's print-media emulation, both from document
view and (as a defensive worst case) from edit mode: no textarea
borders, no input outlines, no navigation, no application buttons
(`.vactions` and `.noprint` were already hidden in print; the new rule
additionally strips any residual form-control chrome). Table and
totals block hold together without splitting mid-row.

## Payment Status

Sourced from the existing `paymentStatus` / `paidAt` fields already
returned by the invoices API — no backend or Stripe changes. Badge
styling reuses the existing `badge-paid` / `badge-pending` /
`badge-failed` / `badge-refunded` / `badge-unpaid` classes already used
elsewhere in the app for visual consistency. The customer-facing public
payment portal (`renderPublicPaymentPortal`) was not touched — it
already had its own clean, document-style layout and is the only place
"PAY INVOICE" appears, per the requirement that internal staff views
only ever show a Payment Link/Send action, not a pay button.

## Responsive QA

Checked at 390×844, 768×1024, and 1366×900+ using Playwright, both
against a static markup harness and against the live app:
- ≤768px: header/banner/meta/bottom-grid sections stack to one column;
  the action bar wraps to two rows; the line-item table scrolls
  horizontally inside its own container instead of compressing.
- Desktop widths: original 3-column header / 2-column banner and
  meta-grid layout preserved.

## Tests

- `backend/app/api`: `npm test` → **118/118 passed** (22 suites),
  unaffected by this change (no backend files touched).
- `backend/app/api`: `npm run test:e2e` → **20/20 passed**, run against
  a local Postgres/Redis/MinIO stack (`docker compose up postgres redis
  minio`) seeded via the repo's own `seed-database.sh`.
- `backend/app/web` (the separate React "Operations Portal" app, also
  untouched): `npm run build` → succeeded.
- The root vanilla-JS frontend (`assets/*`, `index.html`) has no
  existing automated test harness (no `package.json`, no lint config —
  documented in `docs/REPOSITORY_ARCHITECTURE.md` as a deliberate
  no-build, script-tag app). Verification here was done via:
  1. `node --check assets/app.js` for syntax validity.
  2. A Playwright-driven, end-to-end pass against the **real** app and
     a live local API: signed in as the seeded dev admin, opened an
     existing seeded invoice via **View**, created a brand-new test
     invoice (`#1132`, "QA Test Customer Ltd.") through the real
     create form, saved it, and re-opened it via **View** to confirm
     the freshly-entered Bill To / notes render correctly in document
     mode.
  3. Smoke-tested **Payment Link** (modal opens with a working
     copy/checkout link) from the new view-mode action bar.

## Build

- `backend/app/api`: `npm run build` (`nest build`) → succeeded.
- `backend/app/api`: `npm run lint` (`eslint --fix`) → no findings, no
  file changes (working tree stayed clean afterward).
- `backend/app/web`: `npm run build` (`vite build`) → succeeded.
- Root frontend has no build step (static files served as-is).

## Before / After

- **Before**: viewing a saved invoice opened the same bordered
  input/textarea form used for editing — a raw web form pretending to
  be an invoice, with unstyled totals collapsing into cramped,
  concatenated-looking lines and a big empty gap at the bottom from the
  duplicate, unstyled action buttons.
- **After**: viewing a saved invoice shows a clean, read-only commercial
  document — plain-text fields, a professional right-aligned totals
  block with a bold TOTAL, document-style payment-instructions/notes
  sections, and a payment-status badge — with all application controls
  (Payment Link, Send Invoice, Print/PDF, Edit) living outside the
  document in the page header. Editing remains available via an
  explicit "Edit Invoice" action, and print/PDF output is clean in
  either mode.

## Not Changed

Invoice numbering, tax/rebate calculation, payment/Stripe logic,
database schema, invoice API contracts, warehouse authorization, and
RBAC — none of these files were touched.
