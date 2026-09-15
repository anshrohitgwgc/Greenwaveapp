# GreenWave V2 Architecture

This is the unified design doc for the canonical repository
(`anshrohitgwgc/Greenwaveapp`, branch `greenwave-v2`). Frontend and backend
now live in one repo — see `docs/REPOSITORY_ARCHITECTURE.md` for the
directory layout. This file gives the cross-cutting picture; the deep
backend design (schema, RBAC internals, invoice numbering, rounding rules,
etc.) stays in `backend/docs/V2_ARCHITECTURE.md`, which this file does not
duplicate.

## Component map

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ /assets,     │────▶│ backend/app/api  │────▶│ PostgreSQL 16       │
│ /index.html  │     │ (NestJS)         │     │ VM202 192.168.1.22  │
│ (PWA, mobile │◀────│ VM102/201/301,   │     │ (production)        │
│  -first)     │     │ :3000            │     └────────────────────┘
└──────────────┘     │                  │────▶┌────────────────────┐
                      │                  │     │ Redis 7             │
                      │                  │     │ VM104 192.168.1.14  │
                      │                  │     └────────────────────┘
                      │                  │────▶┌────────────────────┐
                      │                  │     │ MinIO S3             │
                      │                  │     │ VM203 192.168.1.23  │
                      └──────────────────┘     └────────────────────┘
                              │
                              ▼
                       VM103 worker: BullMQ (photo thumbnails, audit
                       fan-out — code path exists as `PhotosProcessor`,
                       currently runs in-process behind `WORKER_INLINE`,
                       not yet split into a standalone deployable; see
                       `docs/V2_PRODUCTION_MIGRATION_PLAN.md`)
```

Public routing (confirmed from `backend/infrastructure/nginx/*`, not from
prose docs): `api.gwgc.cloud` and `api.gwgcservers.ca` are the **same**
nginx server block proxying to the `greenwave_api_cluster` upstream
(192.168.1.12/21/31:3000) at **root routes, no `/api/v1` prefix** —
`POST /auth/login`, not `POST /api/v1/auth/login`. The frontend's
`assets/api.js` defaults to same-origin (`''`) for exactly this reason.

`api.gwgcservers.ca` is an alias hostname for this same API, not the
Management Portal (`www.gwgcservers.ca`, `mgmt-api.gwgcservers.ca`,
`n8n.gwgcservers.ca`), which is a fully separate system this work does not
touch — see the "Absolute boundaries" section below.

## Client state vs. server-authoritative state

| Data | Authority | Where |
|---|---|---|
| Session/JWT, current warehouse selection, UI prefs, invoice letterhead defaults, material entity/capture tags | Client | `sessionStorage` (JWT) / `localStorage` (`assets/store.js`) |
| Users, roles, invoices, invoice numbering, inventory transactions & balances, customers, materials, warehouses, photos metadata, timesheets, audit log | **Server** | PostgreSQL, via `backend/app/api` only |
| Photo bytes | Server | MinIO, never the browser |

As of this repo's current `greenwave-v2` state, this is no longer aspirational
for most views: `assets/app.js` calls `assets/api.js`'s `Api.*` methods for
auth, users/staff, warehouses, customers, materials, containers, inventory
transactions/balances, invoices, photos, timesheets, and audit — see
`docs/V2_IMPLEMENTATION.md` for the exact status per area. `assets/store.js`
was reduced accordingly: it no longer holds business records at all, only
the client-local state in the table above (see its module comment for the
full rationale — the backend schema has no column for some of these, e.g.
which of the two companies a material belongs to).

## Authentication and RBAC

Login is email + password against `backend/app/api`'s `POST /auth/login`
(bcrypt(12), Redis-backed rate limit, JWT bearer, 24h expiry). No
self-registration except a bootstrap-only `POST /auth/register` that
409s once any user exists and always forces `role = 'admin'` server-side —
never a caller-supplied role. Three roles are exposed in the frontend
(`ADMIN`, `MANAGER`, `STAFF`; `DRIVER` also exists server-side, mapped to
STAFF-tier). **Every guard runs server-side** (`RolesGuard` + `@Roles(...)`
on each controller method) — the sidebar hiding a button is a UX nicety, not
the enforcement mechanism. Full detail: `backend/docs/V2_ARCHITECTURE.md`
§3–4.

## Feature areas — where the contract lives

For each area, the frontend's `assets/api.js` method names and HTTP calls
are verified by hand against the backend controller they call:

| Area | Frontend | Backend controller |
|---|---|---|
| Auth | `assets/api.js`: `login`, `registerFirstAdmin`, `me` | `backend/app/api/src/auth/auth.controller.ts` |
| Staff/Users | `listUsers`, `createUser`, `updateUser` | `backend/app/api/src/users/users.controller.ts` |
| Warehouses | `listWarehouses`, `createWarehouse`, `updateWarehouse` | `backend/app/api/src/warehouses/warehouses.controller.ts` |
| Customers | `listCustomers`, `createCustomer`, `updateCustomer` | `backend/app/api/src/customers/customers.controller.ts` |
| Materials | `listMaterials`, `createMaterial`, `updateMaterial` | `backend/app/api/src/materials/materials.controller.ts` |
| Inventory | `listContainers`, `createContainer`, `listInventoryTransactions`, `createInventoryTransaction`, `getInventoryBalances` | `backend/app/api/src/inventory/inventory.controller.ts` |
| Invoices | `listInvoices`, `getInvoice`, `createInvoice`, `updateInvoice`, `duplicateInvoice` | `backend/app/api/src/invoices/invoices.controller.ts` |
| Photos | `listPhotos`, `getPhoto`, `uploadPhoto` (multipart), `deletePhoto` | `backend/app/api/src/photos/photos.controller.ts` |
| Timesheets | `clockIn`, `clockOut`, `currentShift`, `shiftHistory`, `teamShifts` | `backend/app/api/src/timesheets/timesheets.controller.ts` |
| Audit/History | `listAudit` | `backend/app/api/src/audit/audit.controller.ts` |

This table, not a generated OpenAPI client, is the current source of truth
for the contract — see `docs/REPOSITORY_ARCHITECTURE.md`'s "Shared code"
section for why, and what would replace it later.

## Absolute boundaries (do not touch)

- **VM105 (192.168.1.15, Management Portal)** and
  `www.gwgcservers.ca` / `mgmt-api.gwgcservers.ca` / `n8n.gwgcservers.ca` —
  a completely separate system (own frontend, API, SQLite, auth/MFA, n8n,
  nginx). Nothing in this repository's code, migrations, or deploy plans
  reads, writes, or proxies to it.
- **Production PostgreSQL/Redis/MinIO/API nodes** (192.168.1.12/13/14/21/22/
  23/31) — this repo's backend has never connected to them; see
  `docs/V2_PRODUCTION_MIGRATION_PLAN.md` for the only sanctioned path to
  changing that, which requires explicit human sign-off at each step.
- **`Adiljaiswal/Greenwave-API`** — the current production backend lineage,
  running on VM102/201/301 today. Treated as a compatibility/reference
  source only; V2 work does not land there.

## Known assumptions carried over from the backend design doc

See `backend/docs/V2_ARCHITECTURE.md` §14 for the full list (DRIVER role
mapping, single shared DB role in this pass, no refresh-token rotation,
etc.) — unchanged by the repo merge.
