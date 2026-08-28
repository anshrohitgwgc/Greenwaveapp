# GreenWave V2 Architecture

Status: implementation in progress on branch `greenwave-v2`. This document is the
design contract for the migrations and modules added in this branch. It extends
(does not replace) `ARCHITECTURE.md`, `DATABASE.md`, `API-CONTRACT.md` and
`SECURITY.md`, which already describe the local-dev scaffold and infra topology.

## 0. Where this lives, and why

Two repositories are in play for GreenWave V2:

- **`FULL-INFRA-V.0001`** (this repo) — the backend. `app/api` already had
  `auth`, `users`, `pickups`, `redis`, `storage` modules and a
  production-isolation policy that matches this task's constraints almost
  exactly. V2 extends `app/api` here rather than starting a second backend
  from scratch.
- **`Greenwaveapp`** (`anshrohitgwgc/Greenwaveapp`) — the existing production
  PWA (static frontend, currently localStorage/IndexedDB only). It becomes the
  primary client of this API. It gets its own `docs/V2_ARCHITECTURE.md`
  scoped to the frontend integration; this document is the backend source of
  truth.

A third repo, `Adiljaiswal/Greenwave-API`, is a near-duplicate of this repo's
`app/api` at an earlier point and has a `.env` pointed at the real production
Postgres/Redis hosts. It is **not** touched by this work, to avoid two
diverging backends.

**Assumption (documented per the completion rule):** "this repository" in the
originating brief is treated as "the GreenWave application repositories this
session controls," not literally the single `Greenwaveapp` static-site repo,
because a backend already existed and duplicating it would create two
sources of truth for the same production data.

## 1. Component map

```
┌─────────────┐     ┌──────────────┐     ┌────────────────────┐
│ Greenwaveapp│────▶│  app/api     │────▶│ PostgreSQL 16       │
│ (PWA, mobile│     │  (NestJS)    │     │ VM202 192.168.1.22  │
│  -first)    │◀────│  VM102/201/  │     │ (production)        │
└─────────────┘     │  301, :3000  │     └────────────────────┘
                     │              │────▶┌────────────────────┐
┌─────────────┐      │              │     │ Redis 7             │
│ app/web     │─────▶│              │     │ VM104 192.168.1.14  │
│ (ops        │◀─────│              │     └────────────────────┘
│  dashboard) │      │              │────▶┌────────────────────┐
└─────────────┘      │              │     │ MinIO S3             │
                      │              │     │ VM203 192.168.1.23  │
┌─────────────┐       │              │     └────────────────────┘
│ app/mobile  │──────▶│              │
│ (Expo)      │◀──────│              │────▶ VM103 worker: BullMQ
└─────────────┘       └──────────────┘        (photo thumbnails,
                                                audit fan-out — code
                                                path exists, not yet
                                                deployed as a separate
                                                process; see §7)
```

Public routing (confirmed from `infrastructure/nginx/*`, not from prose docs
which had drifted): `api.gwgc.cloud` and `api.gwgcservers.ca` are the **same**
nginx server block proxying to the `greenwave_api_cluster` upstream
(192.168.1.12/21/31:3000) at **root routes, no `/api/v1` prefix**. All new
endpoints below follow that convention — `POST /auth/login`, not
`POST /api/v1/auth/login`.

## 2. Client state vs. server-authoritative state

| Data | Authority | Where |
|---|---|---|
| Session/JWT, current warehouse selection, draft invoice being typed, UI prefs | Client | `localStorage` / component state |
| Users, roles, invoices, invoice numbering, inventory transactions & balances, customers, materials, warehouses, photos metadata, timesheets, audit log | **Server** | PostgreSQL, via `app/api` only |
| Photo bytes | Server | MinIO, never the browser |

The browser may cache a read-through copy of server data for offline UX
(this is what `Greenwaveapp`'s existing IndexedDB layer becomes), but it is
never the write-path of record. Every mutation goes through `app/api`, which
validates authorization and writes to Postgres. A client that goes offline
queues mutations and replays them on reconnect against the same validated
endpoints — it does not locally "commit" business data.

## 3. Authentication

- `POST /auth/login` — email (normalized: trimmed, lowercased) + password →
  bcrypt compare (12 rounds) → JWT access token, 24h expiry, `HS256` signed
  with `JWT_SECRET` from env (previously hardcoded in source — fixed in this
  branch).
- No public self-registration. `POST /auth/register` is retained **only** as
  a bootstrap path that is rejected once any user row exists (`409` if the
  `user` table is non-empty), and it always forces `role = 'admin'` for that
  one bootstrap account — it does not trust a caller-supplied role. This
  matches `Greenwaveapp`'s existing "first person creates the administrator
  account" UX, but moves the check server-side where it can't be bypassed by
  editing browser state, and it self-disables after first use.
- All other users are created by an authenticated ADMIN via `POST /users`
  (guarded), never by an unauthenticated caller.
- Passwords: bcrypt, 12 rounds (was 10), never logged, never returned in any
  response body, never stored in `localStorage` on the client.
- Tokens: short-lived JWT bearer in `Authorization: Header`. The existing PWA
  keeps it in memory + `sessionStorage`-equivalent for the session; refresh
  tokens are **not** implemented in this pass (see Known Limitations) — the
  user re-authenticates after 24h.

## 4. Authorization (RBAC)

Roles: `ADMIN`, `MANAGER`, `STAFF` (plus the pre-existing `DRIVER`, treated as
a STAFF-tier role for the pickups module already in production use — not
introduced by this change).

Schema-level RBAC (`roles`, `permissions`, `role_permissions`, `user_roles`)
is added per the brief, but `user.role` (the existing column relied on by
`auth`/`pickups`) remains the fast-path check and is kept in sync 1:1 with
the row in `user_roles` — no breaking change to existing code. A `RolesGuard`
+ `@Roles(...)` decorator centralizes enforcement; every new controller
method is annotated. **The frontend hides controls it doesn't need, but every
guard runs server-side** — a crafted request from a STAFF token to an
ADMIN-only route is rejected regardless of what the UI shows.

## 5. Audit log

`audit_events` is append-only at the application layer: no `PATCH`/`DELETE`
route exists for it anywhere. True DB-level immutability (revoking
`UPDATE`/`DELETE` grants from the app's DB role) requires a second,
least-privileged Postgres role and is listed under Known Limitations — this
pass uses one DB user for the whole app, matching the existing `.env.example`
convention, and enforces immutability only at the API layer.

Every write-path for invoices, inventory transactions, timesheets, photos,
and user/role changes calls a shared `AuditService.record(...)`. Never
recorded: passwords, tokens, or full request bodies — only actor, role,
action, entity type/id, warehouse, and a short human summary.

## 6. Inventory transaction model

No editable "stock total" field exists anywhere. `inventory_transactions` is
append-only (`inbound` / `outbound` / `adjustment`); current stock is a
**derived SQL view** (`inventory_balances`), not a second table that could
drift out of sync with the ledger:

```
current_stock(warehouse, material) =
  SUM(inbound.total) - SUM(outbound.total) ± SUM(adjustment.total)
```

`adjustment` rows require a non-null `reason` (DB constraint + DTO
validation) and always write an `audit_events` row in the same DB
transaction. XL/L/M/S are stored as four numeric columns; `total` is computed
server-side as their sum at write time (never trusted from the client),
rounded per `INVENTORY_ROUNDING_DECIMALS` (env-configurable, default 3, to
match the existing "3.658 t" precision already in production invoices).

## 7. Invoices

Server-authoritative numbering via a Postgres sequence,
`invoice_number_seq`, seeded to continue from the existing production
numbering (`Greenwaveapp`'s current invoices run through **1114**, so the
seed starts the sequence at **1115** — see migration `005`). Numbers are
allocated inside the same transaction that inserts the invoice row, so two
concurrent creates cannot collide or skip-and-reuse a number.

Every field enumerated in the brief (customer, company info, bill-to,
ship-to, PO/reference, terms, line items with qty/unit/price/discount/rebate,
tax rate + label, notes, footer, payment instructions) is a real column or
JSON field, and every field stays editable after a customer/warehouse
prefill — prefill only sets initial values, it does not lock inputs, matching
`Greenwaveapp`'s existing invoice UX (including **rebate lines**, which
subtract rather than add — carried over as `invoice_items.is_rebate`).
Warehouse-based tax defaulting (GST 5% BC/AB, HST 13% ON) becomes
server-side config (`materials`/`warehouses` seed data), not a hardcoded
"Maple Ridge" special case.

## 8. Photos

Upload flow: browser → `POST /photos` (multipart, authenticated) → `app/api`
streams to MinIO with a generated object key → API writes `photos` metadata
row (warehouse, customer, job reference, photo type, taken_by, taken_at) →
returns a short-lived **presigned GET URL** for display. The browser never
receives MinIO credentials. Authorization: STAFF sees only their own photos;
MANAGER/ADMIN see all photos, filterable by date/user/job/customer/warehouse/
type. Every read of a specific photo re-checks that the caller is ADMIN/
MANAGER or the photo's own `taken_by` — this is the IDOR guard (sequential
or guessable photo ids must not leak other staff's images).

This is a separate `photos` table from the legacy `photo` table (which stays
as-is, tied to `pickup`, for backward compatibility with the existing pickups
flow) — see migration `007`.

## 9. Timesheets

`POST /timesheets/clock-in`, `POST /timesheets/clock-out`,
`GET /timesheets/me/current`, `GET /timesheets/me/history`,
`GET /timesheets/team` (MANAGER/ADMIN only). Duplicate active shifts are
prevented by a **partial unique index**
(`WHERE clock_out IS NULL`) — not just an application check — so a race
between two tabs cannot create two open shifts. All timestamps are
`now()` from the database server, never a client-supplied time.

## 10. Warehouses

`warehouses` is a first-class table. `inventory_transactions`, `customers`,
`photos`, and `invoices` all carry a nullable `warehouse_id` FK. No warehouse
name is hardcoded in application code; the frontend gets a warehouse selector
backed by `GET /warehouses`.

## 11. Redis / MinIO / worker usage

- **Redis**: rate-limiting the login endpoint (fixed-window counter per
  IP+email), and as the BullMQ backing store for background jobs (photo
  thumbnail generation). No business data lives only in Redis.
- **MinIO**: photo/file bytes only, via a bucket private to the API's service
  credentials; the browser only ever sees presigned URLs.
- **Worker**: a `PhotosProcessor` (BullMQ consumer) generates thumbnails
  asynchronously after upload. In this pass it runs in-process in `app/api`
  behind a feature flag (`WORKER_INLINE=true` in dev) rather than as the
  separate VM103 process, because there is no dev infrastructure here to run
  a second Node process against a shared Redis — see Known Limitations for
  what changes to split it out for real deployment.

## 12. Identifier strategy

Existing tables (`user`, `pickup`, legacy `photo`) keep their integer
`SERIAL` primary keys — changing them would cascade into every existing FK
and is exactly the kind of blind destructive migration this task says not to
do. Every **new** V2 table introduced in this branch uses `uuid` primary keys
(`gen_random_uuid()`, `pgcrypto` extension) per the brief's explicit
preference. FKs from new tables back to `user.id` stay `integer`.

## 13. Rounding / business rules

Configurable via env, not hardcoded in a component:
`INVENTORY_ROUNDING_DECIMALS` (default 3), `CURRENCY_ROUNDING_DECIMALS`
(default 2). Applied once, server-side, in the service layer that computes
totals — never silently altering a stored transaction value, only how
computed totals are displayed/rounded.

## 14. Known assumptions (per the completion rule, since no one was asked)

1. `api.gwgcservers.ca` is an alias hostname for the same GreenWave API as
   `api.gwgc.cloud` (confirmed from the nginx upstream config, not from the
   prose docs, which are updated in this branch to match). It is **not** the
   Management Portal (`gwgcservers.ca` bare/`www`), which remains untouched.
2. `DRIVER` stays a valid role (pre-existing, used by `pickups`), mapped to
   STAFF-tier permissions in the new RBAC guard.
3. One shared DB role for the app in this pass (matches `.env.example`
   today); a least-privileged separate role for true DB-enforced audit
   immutability is a deployment-time hardening step, not implemented here.
4. No refresh-token rotation in this pass — 24h JWT, re-login after expiry.
