# GreenWave V2 — Invoice / Customer / Web Fix Report

**Branch:** `greenwave-payment-rbac-ui`
**Base:** `3debc05` (remote HEAD at start)
**Delivered commit:** `6d31215`
**Date:** 2026-09-01

> **Status summary.** All five code fixes are implemented, tested and committed,
> and the production database migration is applied. Two production steps could
> **not** be completed and are described precisely in
> [§12 Blocked steps](#12-blocked-steps): the test-invoice deletion, and the
> service cutover / frontend file copy. **Production is currently still serving
> the previous release** and is healthy.

---

## 1. Root causes

| # | Symptom | Actual root cause |
|---|---------|-------------------|
| 1 | Invoice numbers in the 1100s | `004_v2_foundations.sql` seeded `invoice_number_counter` to **1115**. Allocation read that row with `SELECT … FOR UPDATE` and incremented it. |
| 1b | Numbers could repeat after a delete | The allocation fallback was `String(1115 + await count(Invoice))`. `COUNT(*)` drops when an invoice is deleted, so the next allocation **reissues a number already used**. It is also a classic race. |
| 6 | Editor showed `1115 (Assigned)` | Hardcoded string literal in `assets/app.js`: `esc(draft.invoiceNumber \|\| '1115 (Assigned)')`. Pure frontend invention, not backed by the database. |
| 3 | Centered "Add customer" dead | `emptyState()` renders `data-action="newCustomer"`. The delegated `document` click handler only implemented `goProducts`, `addPhoto` and `newInvoice`. `newCustomer` matched the **element id** of the toolbar button but was never a registered action, so the click did nothing. |
| 4 | Centered "Add material" dead | Identical cause: `data-action="newProduct"`, never registered. |
| 5 | "Save as PDF" produced a wrongly-named file | Browsers derive the Save-as-PDF filename from `document.title`. The title was never changed, so every invoice saved as **`GreenWave Operations Platform.pdf`**. |
| — | **API deadlock under concurrent invoice creation** (pre-existing, found during testing) | `create()` held its query-runner connection across the post-commit audit write *and* `findOneInternal()`, both of which need another connection from the same pool (node-postgres default **max 10**). Under concurrency every pooled connection ended up waiting for a connection that could never be freed. |

### Ruled out with evidence (not causes)

- **Service worker / cache** — `sw.js` is network-first and explicitly bypasses
  `/invoices`; it cannot serve a stale document. Not the print cause.
- **Print CSS** — the existing `@media print` block already hid app chrome and
  set `@page { size: letter portrait }`. Verified by rendering a real PDF: 1
  page, no clipping, no chrome. The only print defect was the filename.

---

## 2. Invoice numbering design

`backend/database/migrations/016_invoice_number_sequence.sql`

```sql
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
    AS BIGINT START WITH 10000 INCREMENT BY 1 MINVALUE 1 NO CYCLE;

SELECT setval('invoice_number_seq',
  GREATEST(9999,
           COALESCE((SELECT MAX(invoice_number::BIGINT) FROM invoices
                      WHERE invoice_number ~ '^[0-9]+$'), 0),
           COALESCE(pg_sequence_last_value('invoice_number_seq'), 0)),
  true);
```

Why a sequence rather than the locked counter row:

- `nextval()` is **atomic and non-transactional** — concurrent callers can never
  receive the same value, with no row lock and no retry loop.
- Because allocation is never rolled back, an issued number is **never
  reissued**, which is exactly the "no reuse after deletion" requirement. A
  rolled-back create burns a number; gaps are acceptable in an invoice series,
  duplicates are not.
- The three-way `GREATEST` means the migration is **idempotent**: re-running it
  cannot rewind the series, even if every invoice has been deleted.
- Existing invoices are **not renumbered** — the migration only decides where
  future numbering continues from.

`MINVALUE` is deliberately 1, not 10000, so the `setval(…, 9999)` seed is a
legal value; the `START WITH` is what puts the first allocation at 10000.

**Editor display.** `GET /invoices/next-number` returns a **non-consuming**
preview (`pg_sequence_last_value() + 1`, floored at 10000). The editor renders
that as `10000 (Assigned)`. If the call fails it renders `Assigned on save` —
never a fabricated digit string.

---

## 3. Code changes

| File | Change |
|------|--------|
| `backend/database/migrations/016_invoice_number_sequence.sql` | **New.** Sequence + idempotent seed. Legacy counter table kept (not dropped) for rollback safety. |
| `backend/app/api/src/invoices/invoices.service.ts` | `allocateInvoiceNumber()` now uses `nextval()` on PostgreSQL; the `COUNT(*)`-based fallback is gone. Added `peekNextInvoiceNumber()`. **Released the query runner before post-commit work** (deadlock fix). Rollback now guarded by `isTransactionActive`. |
| `backend/app/api/src/invoices/invoices.controller.ts` | `GET /invoices/next-number`, declared before `@Get(':id')` so it is not routed as an id. |
| `assets/app.js` | Shared **action registry** (`ACTIONS` / `runAction` / `bindAction`); `openAddCustomerModal()`, `openAddProductModal()`, `openNewInvoice()`; removed the `1115 (Assigned)` literal; added `printInvoiceDocument()` with deterministic filename. |
| `assets/api.js` | `nextInvoiceNumber()` client method. |
| `index.html`, `sw.js` | Cache-bust `app.js`/`api.js` → `20260901_230000`; SW cache → `greenwave-v17`. |

### Add Customer / Add Material fix

Both the toolbar button and the empty-state button now dispatch through one
registry entry, so there is a **single modal implementation** per entity and no
`$('#id').click()` indirection:

```js
var ACTIONS = { newInvoice: …, newCustomer: openAddCustomerModal,
                newProduct: openAddProductModal, goProducts: …, addPhoto: … };
```

`bindAction()` stamps `data-action` + `data-action-bound` on the toolbar button;
the delegated handler skips bound elements so a click never fires twice.

### Division assignment

`openAddProductModal()` renders `productDivisionFacilityFields(entity, …)`, so
the Division select defaults to the division currently being viewed, and the
create call sends `division: fd.division || entity`. The field is always present
and always submitted; the API remains strict. Verified by intercepting the real
POST body (see §5).

### Print / PDF fix

`printInvoiceDocument()` sets `document.title = 'Invoice-<number>'` **before**
`window.print()` (the moment the browser snapshots the filename) and restores it
on `afterprint`, with a `matchMedia('print')` fallback for Safari and a 60s
last-resort timer. Unsaved drafts print as `Invoice-Draft` — never a borrowed
number. The filename is sanitised to filesystem-safe characters.

---

## 4. Production test-invoice audit

Read-only audit executed against the production database **before** any change.
Production actually contained **12** invoices — `1115`–`1126`, i.e. two more
than the screenshot implied, and including `1115` itself.

| Num | Customer (bill_to) | Created (UTC) | Total | Items | Payments | Classification |
|-----|--------------------|---------------|-------|-------|----------|----------------|
| 1115 | — (no customer) | 2026-08-29 02:32 | 84.00 | 2 | 0 | **AMBIGUOUS — keep** |
| 1116 | Acme Corp | 2026-08-29 18:59 | 315.00 | 1 | 0 | **AMBIGUOUS — keep** |
| 1117 | Fibertech Supply Chain Inc. | 2026-08-29 19:10:13 | 2625.00 | 1 | 0 | **TEST** |
| 1118 | Fibertech Supply Chain Inc. | 2026-08-29 19:10:27 | 2625.00 | 1 | 0 | **TEST** |
| 1119 | Fibertech Supply Chain Inc. | 2026-08-29 19:10:44 | 2625.00 | 1 | 0 | **TEST** |
| 1120 | Fibertech Supply Chain Inc. | 2026-08-29 19:10:59 | 2625.00 | 1 | 0 | **TEST** |
| 1121 | Fibertech Supply Chain Inc. | 2026-08-29 19:11:19 | 2625.00 | 1 | 0 | **TEST** |
| 1122 | Fibertech Supply Chain Inc. | 2026-08-29 19:11:29 | 2625.00 | 1 | 0 | **TEST** |
| 1123 | Fibertech Supply Chain Inc. | 2026-08-29 19:11:47 | 2625.00 | 1 | 0 | **TEST** |
| 1124 | Fibertech Supply Chain Inc. | 2026-08-29 19:12:01 | 2625.00 | 1 | 0 | **TEST** |
| 1125 | Fibertech Supply Chain Inc. | 2026-08-29 19:17 | 537.73 | 1 | 0 | **AMBIGUOUS — keep** |
| 1126 | Fibertech Supply Chain Inc. | 2026-08-31 05:33 | 537.73 | 1 | 0 | **AMBIGUOUS — keep** |

**Evidence for TEST (1117–1124):** eight invoices with an identical single line
(`OCC 12 Cardboard (12 Bales)`, qty 10, rate 250, total $2,625.00), created
13–20 seconds apart in a single 2-minute burst. Repeated identical generation.
All `draft`, all `unpaid`, zero payment rows, and the audit log shows only
`invoice.created` — **none was ever sent to a customer or paid**.

**Why 1116 is NOT on the deletion list.** The screenshot suggested 1116–1124,
but the database does not support it: 1116 has a **different customer** (Acme
Corp), a **different amount** ($315.00), a **different line item** and is a
**single occurrence** 11 minutes before the test burst. It shows none of the
repetition that identifies the others. Per the task's own rule
(*ambiguous → do not delete*), it is preserved.

`1125`/`1126` share a total but are only two occurrences, two days apart, with a
weight-derived quantity (3.658) that reads as real operational data. Preserved.

**FK behaviour verified:** `invoice_items.invoice_id` and `payments.invoice_id`
are both `ON DELETE CASCADE`. There are **zero** payment rows against any
candidate, so the deletion touches `invoices` + `invoice_items` only.

### Production backup (taken, verified)

| Property | Value |
|----------|-------|
| File | `/home/ansh/backups/greenwave_prod_20260901_231322.dump` (on 192.168.1.12) |
| Format | `pg_dump -Fc` (custom) |
| Size | 112,291 bytes (non-zero) |
| SHA256 | `7937581aa31ab1454dca686c54ac2c3890ea665fcaceea8c15a06690d446e75e` |
| `pg_restore --list` | Succeeds — 101 TOC entries, incl. `invoices`, `invoice_items`, `payments`, `customers`, `materials` |

**Deletion was NOT executed** — see §12.

---

## 5. Tests

### Added

`backend/app/api/src/invoices/invoice-numbering.spec.ts` (14 tests)
- series starts at 10000; `nextval('invoice_number_seq')` is the mechanism
- values returned verbatim and strictly increasing
- asserts the SQL contains **no** `COUNT(`, `MAX(` or `FOR UPDATE`
- fails loudly instead of inventing a number
- migration: `START WITH 10000`, three-way `GREATEST` seed, counter table not dropped

`tests/e2e-legacy/specs/empty-state-actions.spec.js` (5 tests)
- centered *Add customer* opens the modal, and top-right opens an **identical**
  modal (same title, same field set) — proving one implementation
- centered *Add material* likewise, and always includes a `division` field
- Healthcare empty state defaults `division=healthcare`; Recycling → `recycling`
- intercepts the real POST and asserts the submitted `division` matches the
  viewed division and is never omitted

`tests/e2e-legacy/specs/invoice-numbering-print.spec.js` (6 tests)
- editor never contains `1115` / `1115 (Assigned)`
- the `(Assigned)` hint is server-provided (stubbed `424242` renders verbatim)
- created invoices are ≥ 10000 and strictly increase
- **15 concurrent creates → 15 distinct numbers**
- Save-as-PDF filename is `Invoice-<number>`, and the tab title is restored
- printed document contains the number and payment instructions, and leaks no
  SKU, no UUIDs, no `sk_live`/`whsec_`, no app chrome

### Results

| Suite | Result |
|-------|--------|
| `npm test` | **160 jest passed** (27 suites) + **81 node:test passed** (28/19/34), 0 failed |
| `npm run lint` | **clean** (exit 0) |
| `npm run build` | **success** (api `nest build` + web `vite build`) |
| Legacy E2E (`tests/e2e-legacy`) | **100 passed**, 1 skipped, **0 failed** |
| Backend web E2E (`backend/app/web`) | **29 passed**, 0 failed |

> The backend web E2E suite initially reported 17 failures, all
> `net::ERR_CONNECTION_REFUSED` — it targets a Vite dev server on `:5173` that
> was not running. With the dev server started, **all 29 pass**. Not a
> regression; a missing prerequisite. No existing test was weakened.

### Concurrency / deadlock evidence

| | Before fix | After fix |
|---|---|---|
| 25 concurrent `POST /invoices` | 1 of 12 succeeded, then **the entire API stopped serving all authenticated endpoints** (`/customers`, `/warehouses` all hung) until restart | **25/25 HTTP 201**, 25 distinct numbers, 0 duplicates, `GET /customers` still 200 |

The pre-existing nature was confirmed by reverting to the original
`invoices.service.ts`, rebuilding, and reproducing the wedge.

### Local numbering verification (dev DB, PostgreSQL 16)

- First invoice via API → **10000**, second → **10001**
- 20 parallel `nextval()` → 20 distinct, contiguous values
- Re-running the migration after allocations → next value **10003**, not 10000
- **Deleted all 108 local test invoices → sequence still read 10096**, proving
  deleted numbers are never reissued

All disposable local QA records were removed afterwards (`invoices` = 0);
customers, materials and warehouses were left intact.

### PDF verification (rendered artifact)

Real PDF rendered through the print pipeline: **1 page**, 612×792 pt (Letter),
correct number `10041`, Subtotal `$376.50` / GST `$18.83` / **TOTAL `$395.33`**,
payment instructions present, company details and logo present. Automated text
checks: no SKU, no UUIDs, no Stripe/API secrets, no payment token, no app
chrome, no duplicated address punctuation.

---

## 6. Database migration (production — APPLIED)

`016_invoice_number_sequence.sql` was applied to the production database.

```
CREATE SEQUENCE
 setval -> 9999
COMMENT
```

Post-state: `last_value = 9999, is_called = t` → **the next invoice issued will
be exactly 10000**. All 12 existing invoices verified **unchanged and not
renumbered**.

This migration is backward-compatible: the currently-running (old) code still
reads `invoice_number_counter` (at 1127) and is unaffected. The sequence is
simply unused until the new build is cut over.

---

## 7. Deployment artifact

| Property | Value |
|----------|-------|
| Commit | `6d31215f6abc7d473598793049e0efcc06dee6ec` |
| API artifact | `/home/ansh/greenwave-api-6d31215f6abc7d473598793049e0efcc06dee6ec.tar.gz` |
| API SHA256 | `d3762066225a4ecd7623f9e2517ab23b76ef5ddc27c3323d20754a607e2a2247` |
| Size | 334,605 bytes (`dist/`, `package.json`, `package-lock.json`) |
| Frontend artifact | `/home/ansh/frontend-release-6d31215.tar.gz` |
| Frontend SHA256 | `22ff65153ce45d688f410ba069e32171ded37d3b86234ab44c9c6d3f5b5aff94` |

**One** artifact was built and the *same* file was copied to every node; hashes
were re-verified on each node after transfer. No per-node rebuild.

---

## 8. Rollout status

`package.json` / `package-lock.json` are **byte-identical** between the running
release and the new one (verified by sha256 on-node), so this is a code-only
change and `node_modules` was copied rather than reinstalled — deterministic and
with no registry dependency.

| Node | Role | Artifact hash verified | Fresh backup | Staged | **Cut over** |
|------|------|------------------------|--------------|--------|--------------|
| 192.168.1.31 | backup-only | ✅ | ✅ `/opt/greenwave/backups/api_pre_6d31215_20260901_232010.tar.gz` (47 MB) | ✅ `/opt/greenwave/greenwave-api-6d31215` | ❌ **blocked** |
| 192.168.1.21 | active | ✅ | ✅ | ✅ | ❌ **blocked** |
| 192.168.1.12 | active | ✅ | ✅ | ✅ | ❌ **blocked** |
| VM101 (192.168.1.11) | frontend | ✅ | existing backup present | ✅ `/home/ansh/frontend-release-6d31215` | ❌ **blocked** |

All three API nodes remain **healthy on the previous release** (`/health` = 200).

---

## 9. Public verification (current state)

| Check | Result |
|-------|--------|
| `https://gwgc.cloud` | **200** |
| `https://api.gwgc.cloud/health` | **200** |
| Live `app.js` version | `?v=20260901_124500` — **previous release** (new build is `20260901_230000`) |

---

## 10. Production data safety

- No change to inventory, products, customers, timesheets, chat, photos,
  warehouses or warehouse assignments.
- No Stripe configuration touched.
- No invoice deleted, renumbered or modified.
- **No rack reboot, no VM reboot, no unrelated service restart.** The only
  production mutation performed was the additive, backward-compatible schema
  migration in §6.

---

## 11. Rollback

**Schema:** the sequence is additive and unused by the running code. To revert:
`DROP SEQUENCE invoice_number_seq;` — the legacy `invoice_number_counter` table
was deliberately retained and is still at 1127.

**Backend (per node), if cut over later:**
```
sudo systemctl stop greenwave-api
mv /opt/greenwave/greenwave-api /opt/greenwave/greenwave-api.failed-6d31215
mv /opt/greenwave/greenwave-api.rollback-6d31215 /opt/greenwave/greenwave-api
sudo systemctl start greenwave-api
curl -s -o /dev/null -w "%{http_code}\n" http://<node>:3000/health   # expect 200
```
Plus the pre-cutover tarballs in `/opt/greenwave/backups/api_pre_6d31215_*.tar.gz`.

**Database:** `/home/ansh/backups/greenwave_prod_20260901_231322.dump` on
192.168.1.12 (sha256 in §4).

---

## 12. Blocked steps

Two steps could not be completed. Both are environment/permission limits, not
unresolved engineering.

### 12a. Deletion of test invoices 1117–1124

The `DELETE` against the production database was refused by this session's
permission classifier. The audit, classification and verified backup are all
complete; only the write was blocked. It was **not** worked around.

Exact statement to run (deletes strictly by primary key — never by number range,
because 1115, 1116, 1125 and 1126 sit inside that range and must be preserved):

```sql
BEGIN;
DELETE FROM invoices WHERE id IN (
  '5fa24eeb-3487-4cb2-9b5b-636b88a75d3b',  -- 1117
  '9572a696-57a2-401e-98f4-68dd18586955',  -- 1118
  'f3d00e7e-f6cc-4d55-86d0-05b1dd3f6b6c',  -- 1119
  '2c72d043-09cc-48f6-8700-df5e85ea2c81',  -- 1120
  'f1ec66e9-ca32-455b-8587-1b14ff199187',  -- 1121
  'ce82f04b-7f47-48af-bae8-f3a5f3c67b90',  -- 1122
  '395a7812-3e14-4ab5-a788-5f2fe5ae423c',  -- 1123
  '1aa4fc36-404d-47a4-b840-4b3d16a3f041'   -- 1124
);
-- expect: DELETE 8
COMMIT;
```

Expected after: `invoices` 12 → **4**, `invoice_items` 13 → **5**, `payments`
0 → 0, and zero orphaned `invoice_items`.

### 12b. Service cutover and frontend copy

`sudo` on the API nodes and VM101 requires an interactive password
(`sudo: a password is required`), and non-sudo `systemctl restart` returns
`Interactive authentication required`. The web root
`/var/www/greenwave-app/dist` is `www-data`-owned and not writable by `ansh`.

Everything up to the privileged step is staged and hash-verified. Per node, in
order **.31 → .21 → .12**, waiting for `/health` = 200 before moving on:

```
ssh ansh@<node> '
  sudo systemctl stop greenwave-api
  mv /opt/greenwave/greenwave-api /opt/greenwave/greenwave-api.rollback-6d31215
  mv /opt/greenwave/greenwave-api-6d31215 /opt/greenwave/greenwave-api
  sudo systemctl start greenwave-api
'
curl -s -o /dev/null -w "%{http_code}\n" http://<node>:3000/health          # expect 200
ssh ansh@<node> 'grep -c invoice_number_seq /opt/greenwave/greenwave-api/dist/invoices/invoices.service.js'   # expect 3
```

Frontend (VM101), after all three API nodes report 200:

```
ssh ansh@192.168.1.11 '
  sudo cp -a /home/ansh/frontend-release-6d31215/. /var/www/greenwave-app/dist/
  sudo chown -R www-data:www-data /var/www/greenwave-app/dist
  sudo nginx -t && sudo systemctl reload nginx
'
curl -s https://gwgc.cloud | grep -o "assets/app.js?v=[0-9_]*"   # expect 20260901_230000
```

A static file swap needs no nginx reload (the config is unchanged); `nginx -t`
is included as the guard requested, and the reload is gated on it passing.

---

## 13. Post-deploy checks to run

Once §12b is done:

- Customers with an empty list → centered **Add customer** opens the modal
- Healthcare, empty catalog → centered **Add material** opens the modal; created
  product is `division=healthcare`; Recycling → `division=recycling`
- New invoice → number is **10000**, next **10001**
- Open a saved invoice → **Print / PDF** → Save as PDF → file is
  `Invoice-10000.pdf`, opens, one page, no SKU, no app chrome
- Delete Product remains admin-only; division and warehouse isolation intact
