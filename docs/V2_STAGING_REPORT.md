# GreenWave V2 — Gate 1 Staging Report

Real, non-mocked staging run against the unified repo's `backend/app/api`
(the canonical V2 backend as of the `30fb9da` subtree merge). No production
system was touched, queried, or scanned — see "What was not touched" at the
end.

## 1. Context — two parallel Gate 1 efforts, this one supersedes the other

Two independent sessions worked this ticket concurrently. One (this
document's predecessor work) built a second, separate backend in a
standalone `FULL-INFRA-V.0001-main` repo and wired the frontend against it.
The other — the work this report is about — merged the actual
`FULL-INFRA-V.0001` backend into `Greenwaveapp` itself as `backend/`
(matching the ticket's original premise that frontend and backend live in
one repository) and is materially more complete: a real `roles`/
`permissions` RBAC schema, a `containers` concept, login rate-limiting, and
54 passing unit/integration tests across 16 suites.

That backend's own docs were explicit that it had **never been run against
real infrastructure** — every status table in the pre-existing
`docs/V2_IMPLEMENTATION.md` read "NOT INTEGRATION TESTED... this sandbox
has neither Docker nor local instances" and "NOT BROWSER TESTED — no
display in the sandbox." This report is that missing verification: the
more complete implementation, actually run against real Postgres, Redis,
and MinIO, and a real browser. The separate standalone-repo effort's work
is preserved for reference on the `my-wiring-superseded-gate1` branch of
`Greenwaveapp` but is not part of the canonical result.

## 2. Staging infrastructure — rootless, no Docker

Docker was not available in the build environment. All three services are
real, unmodified upstream binaries running as plain local processes — not
containers, not mocks:

| Service | Version | How obtained | Port |
|---|---|---|---|
| PostgreSQL | 16.15 (Ubuntu build) | `apt-get download` + `dpkg -x` (extract only, no system install, no root) | 5433 |
| Redis | 7.0.15 (Ubuntu build) | same extraction method | 6380 |
| MinIO | RELEASE.2025-09-07 | official static binary from `dl.min.io` | 9002 (API), 9003 (console) |

Credentials are staging-only, randomly generated, kept in a local
`.env` (gitignored, never committed — this document names the env var
keys, not values). Backend ran via `node dist/main.js` on port 4000;
frontend served via `python3 -m http.server 8081`, with
`localStorage.setItem('greenwave.apiBase', 'http://127.0.0.1:4000')` —
never pointed at `api.gwgc.cloud`.

## 3. Migrations 001–010 — applied, one real bug found and fixed

All ten migrations from `backend/database/migrations/` applied to the
staging database. **Migration 005 (`005_rbac_schema.sql`) failed on its
last statement** on real Postgres:

```
ERROR: operator does not exist: character varying = user_role
LINE: ...JOIN roles r ON r.name = u.role
```

`roles.name` is `varchar`; `user.role` is the `user_role` enum — comparing
them directly is invalid in Postgres (this passed in the project's own
sqlite-based test suite, which doesn't have or enforce Postgres enum
typing). Fixed by casting: `r.name = u.role::text`. Migration re-applied
cleanly (idempotent — `IF NOT EXISTS`/`ON CONFLICT DO NOTHING` throughout).
Everything before that line in 005 (the `roles`/`permissions`/
`role_permissions` tables and their seed rows) had already applied
successfully in the failed run.

**Full schema verified via `psql` introspection:**

| Check | Result |
|---|---|
| Tables | 18 (including the pre-existing `pickup`/`photo` plus V2's `warehouses`, `customers`, `materials`, `containers`, `invoices`, `invoice_items`, `invoice_number_counter`, `inventory_transactions`, `photos`, `timesheets`, `audit_events`, `roles`, `permissions`, `role_permissions`, `user_roles`) |
| Views | `inventory_balances` |
| UUID columns | 29 — nearly every V2 table uses UUID PKs/FKs |
| Foreign keys | present throughout, including every warehouse relationship |
| Timesheet uniqueness | `idx_one_active_shift_per_user` — a partial unique index `ON timesheets(user_id) WHERE clock_out IS NULL` |
| Invoice numbering | `invoice_number_counter` table, verified concurrency-safe under real `FOR UPDATE` locking (§6) |
| Audit events | `audit_events` table, confirmed insert-only usage, no secrets found in any row |

## 4. Backend — built by the other session, verified and fixed by this one

`npm test` inside `backend/app/api`: **54/54 tests passed, 16 suites** —
confirmed independently, matching the project's own claim.

`npx nest build`: clean.

**Two real bugs found by running against actual infrastructure (not
caught by the mocked test suite) and fixed in this pass:**

1. **`InvoiceItem` entity missing `@JoinColumn`** — it declared both an
   explicit `@Column({ name: 'invoice_id' })` and a `@ManyToOne` relation
   with no `@JoinColumn`, so TypeORM invented its own phantom `invoiceId`
   column that doesn't exist in Postgres. Every `GET /invoices` (or any
   query loading the `items` relation) 500'd:
   `column InvoiceItem.invoiceId does not exist`. This only worked in the
   test suite because it runs against sqlite with `synchronize: true`,
   which silently creates both columns. Fixed with
   `@JoinColumn({ name: 'invoice_id' })`.
2. **`POST /photos` accepted any file type** — no MIME-type check existed;
   uploading a plain `.txt` file succeeded and was stored in MinIO under
   its original name. Added an allowlist (`image/jpeg`, `image/png`,
   `image/webp`), matching the size limit that already existed.

Everything else — auth (bootstrap-once register, login, RBAC via the real
`roles`/`permissions` schema), warehouses, customers, materials,
containers, inventory, invoices, photos, timesheets, audit — was exercised
live against the real staging stack and worked as designed. `POST /users`
does **not** leak the password hash (already correct in this codebase,
unlike an earlier draft of the standalone-repo effort, which fixed the
same class of bug independently).

## 5. Worker

`PhotosProcessor` runs inline (`WORKER_INLINE=true`), unchanged by this
pass — not split to a standalone VM103 process, per the ticket's
instruction not to deploy there. Gate 3 of `docs/V2_PRODUCTION_MIGRATION_PLAN.md`
already documents the exact extraction steps for later.

## 6. Functional tests — all against real staging infra

**Invoices (10 concurrent creates):** the `invoice_number_counter` +
`FOR UPDATE` mechanism — explicitly flagged in this backend's own docs as
"NOT INTEGRATION TESTED (sqlite can't prove that)" — produced **10 unique
numbers under real concurrent load, zero collisions, zero errors**. All 10
totals matched the frontend's worked example exactly: 3.658 t × $140.00 →
subtotal $512.12, tax (5%) $25.61, total **$537.73**. **PASS.**

**Inventory (Warehouse A/B isolation):** A: inbound 10, outbound 3,
adjustment +1 → balance **8**. B: inbound 50 only → balance **50**, zero
cross-warehouse leakage via the `inventory_balances` view. Note: the
`adjustment` transaction type only accepts non-negative quantities in the
current DTO (`@Min(0)` on the size fields) — there's no way to record a
downward correction through this endpoint as currently validated; flagged
as a limitation, not fixed in this pass (unclear whether `outbound` is the
intended mechanism for corrections instead). **PASS** (isolation and
concurrency-safety both confirmed; the negative-adjustment gap noted
separately).

**Photos:** a real JPEG uploaded through `POST /photos` → confirmed landed
in MinIO (`mc ls`) → the endpoint's own response included a presigned URL
→ downloaded and byte-compared identical to the source file → direct
unauthenticated access to the same object denied (403, bucket private) →
a different staff account's request for the same photo denied (403, IDOR
blocked) → a non-image upload rejected (400, after this pass's fix — see
§4). **PASS.**

**Timesheets:** 10 concurrent `POST /timesheets/clock-in` for the same
staff account → **exactly 1 succeeded, 9 got 409**, enforced by
`idx_one_active_shift_per_user` at the database level. Clock-out persisted
and appeared in history. **PASS.**

**Audit:** 37 real events across the session, each with actor (id + role),
timestamp, action, entity, warehouse where applicable, and a human-readable
summary (e.g. `"admin@greenwave.test created invoice #1126 (total
537.73)"`). Raw-row grep for password/hash/bearer/JWT-shaped content:
**none found**. Endpoint RBAC-restricted to manager+ (staff got 403).
**PASS.**

## 7. Real browser QA — Playwright + Chromium (not simulated)

Chromium 151 via Playwright. All five required viewports, against the
frontend on `:8081` pointed at staging `:4000`:

| Viewport | Blank screen | Logged in | Console errors | Failed requests | Horizontal overflow |
|---|---|---|---|---|---|
| 1920×1080 | no | yes | 0 | 0 | no |
| 1440×900 | no | yes | 0 | 0 | no |
| 1280×720 | no | yes | 0 | 0 | no |
| 390×844 | no | yes | 0 | 0 | no |
| 430×932 | no | yes | 0 | 0 | no |

Every nav view (inventory, weigh-in, invoices, photos, timeclock,
customers, materials, staff, history) reachable at every viewport,
including opening the off-canvas mobile menu drawer on the two phone sizes.

**Interactive workflow test** (real clicks/fills): signed in as manager →
added a customer via the UI (persisted, visible without a reload) →
created an invoice via the UI (server-assigned #1127) → uploaded a real
photo via the UI (grid rendered a genuine presigned MinIO URL) → clocked
in via the UI (visible state change). **Zero console errors across the
entire sequence.**

**PASS.**

## 8. PWA

- **Fresh install:** service worker registers, activates, precaches all 11
  files into `greenwave-v6`.
- **Genuine upgrade path** (a client actually installed on the file that
  was the real `sw.js` immediately prior to this pass, cache name
  `greenwave-v5`, then served the actual current `sw.js`): browser's real
  update → install → activate cycle ran, dropped `greenwave-v5`, adopted
  `greenwave-v6` with the correct 11 files. Not simulated by hand-editing
  the cache.
- **Offline:** fully offline browser context still returned 200 with the
  full cached document at `/`.
- **Manifest:** valid — name, short_name, start_url, standalone display, 3
  icons.

**PASS.**

## 9. API performance (staging, local rootless stack)

| Endpoint | Avg latency (5 runs) |
|---|---|
| `GET /health` | 1.5 ms |
| `POST /auth/login` | 277.5 ms (bcrypt cost, intentional) |
| `GET /customers` | 3.4 ms |
| `GET /inventory/balances` | 3.7 ms |
| `GET /invoices` | 5.5 ms |
| `GET /timesheets/me/history` | 3.8 ms |
| `POST /photos` (1 upload) | 29.0 ms |

Local single-node numbers, not representative of production's multi-VM
topology, and not a load test.

## 10. Security

- Wrong password / unknown email → both 401 with a generic message.
- RBAC boundaries hold: staff blocked from `/audit`; only admin can delete
  photos.
- IDOR: a staff member's request for another staff member's photo → 403.
- File upload: non-image rejected after this pass's fix (§4) — **was a
  real gap before this pass, any file type was previously accepted.**
- Tampered JWT → 401.
- SQL-injection-shaped input stored and returned as inert text — table
  intact afterward.
- Bootstrap-only registration: second attempt after an admin exists → 400
  (blocked, though 403 would be more semantically precise — not fixed,
  low-severity naming choice not a security gap).
- No secrets found in any audit_events row.

**PASS** (after the file-type fix in §4).

## 11. Production schema comparison — read-only

No connection to `192.168.1.22` was attempted (per the ticket's "do not
touch production," and this sandbox has no route there regardless — see
the other session's finding, unchanged). `docs/V2_ARCHITECTURE.md` and
`backend/docs/DATABASE.md` document production's `user`/`pickup`/`photo`
schema only. Every V2 table (004–010, this repo's numbering:
`004_v2_foundations` through `010_audit_events`) is net-new or an additive
column on `photo`/`user` — no destructive `ALTER`/`DROP` anywhere in the
V2 migration set. **PRODUCTION SCHEMA COMPATIBILITY: PASS** (docs-based
comparison, not a live introspection — see `docs/V2_PRODUCTION_MIGRATION_PLAN.md`
Gate 0 for what's still an open question about production's actual state).

## 12. Known limitations / not done in this pass

- **Negative inventory adjustments** aren't expressible through
  `POST /inventory/transactions` as currently validated (§6).
- **The "closed tab, `sessionStorage` cleared" auth-gate scenario** and
  the exact bootstrap-vs-sign-in toggle UI weren't exercised this pass —
  see `docs/V2_PRODUCTION_MIGRATION_PLAN.md` Gate 2.
- **Worker still inline**, not split to VM103 (unchanged, not required by
  this gate).
- Two sessions independently discovered and fixed a "password hash leaks
  in the create-user response" class of bug in their respective backends
  during this same work — this repo's `backend/` was already correct;
  flagging only because it's a bug class worth a lint rule or a shared
  response DTO going forward, not because it's present here.

## 13. What was not touched

`gwgc.cloud`, `api.gwgc.cloud`, `192.168.1.12/21/31` (prod API nodes),
`192.168.1.22` (prod Postgres), `192.168.1.14` (prod Redis), `192.168.1.23`
(prod MinIO), `192.168.1.13` (prod worker), `www.gwgcservers.ca`,
`mgmt-api.gwgcservers.ca`, `n8n.gwgcservers.ca`, VM105 / `192.168.1.15`. No
migration was applied anywhere but the staging database described in §2.
