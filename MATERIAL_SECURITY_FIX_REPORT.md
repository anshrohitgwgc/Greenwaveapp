# Material Detail IDOR — Security Fix Report

**Branch:** `greenwave-payment-rbac-ui`
**Base commit:** `cfb31c3` (`docs: add inventory/invoice/isolation verification report`)
**Production status:** NOT DEPLOYED. No production system, DB, host, or
deploy pipeline was touched. All verification ran against a local, isolated
in-memory (better-sqlite3) test database via the existing e2e harness.

## Security Issue

`GET /materials/:id` had no authorization check. `MaterialsService.findOne`
ran `materialRepository.findOne({ where: { id } })` and returned whatever
record matched, with no check against the caller's warehouse/division
access. Any authenticated user — regardless of role or `UserWarehouse`
assignment — could enumerate material UUIDs and read full records
(name, category, description, price, division, warehouse) belonging to
facilities they had no access to. This is a classic IDOR
(CWE-639 / OWASP A01: Broken Access Control).

`findAll`, `create`, and `update` were already correctly scoped through
`WarehousesService.assertWarehouseAccess` / `getUserAuthorizedWarehouseIds`
— confirmed by reading their implementations before making any change.

## Fix

Reused the existing warehouse-authorization architecture (no second
permission system introduced):

- `MaterialsService.findOne(id, actor)` now fetches the material, then calls
  `warehousesService.assertWarehouseAccess(actor, material.warehouseId)`
  before returning it. Unauthorized access throws `ForbiddenException`
  (403), the same exception `assertWarehouseAccess` already throws for
  `findAll`, `create`, and `update`.
- `MaterialsController.findOne` now takes `@CurrentUser() actor` and passes
  it to the service.
- Existence is still checked first (404 for a genuinely nonexistent ID),
  matching the ordering `update` already used.
- Materials with `warehouseId: null` remain globally readable by any
  authenticated user, consistent with how `findAll` already treats them as
  shared/global stock.

Division (`recycling` / `healthcare`) confirmed to have **no independent
authorization boundary anywhere in this codebase** — it's a data attribute
used for filtering and unit-type business rules only (checked
`inventory.service.ts`, which has the identical division model). The fix
does not add one, since doing so would be a new permission system the task
explicitly said not to invent.

## Files Changed

- `backend/app/api/src/materials/materials.service.ts` — added
  `findMaterialOrFail` (private), authorized `findOne(id, actor)`; `update`
  now uses the private helper internally (its own two
  `assertWarehouseAccess` calls are unchanged).
- `backend/app/api/src/materials/materials.controller.ts` — `findOne` now
  accepts `@CurrentUser()` and passes it through.
- `backend/app/api/src/materials/materials.service.spec.ts` — added 5 unit
  tests for the new `findOne` authorization guard.
- `backend/app/api/test/payment-rbac.e2e-spec.ts` — seeded materials across
  all 3 facilities × 2 divisions + 1 global material, added an Ontario-only
  staff user, and added a `2b. Material Detail IDOR Defense` block with 14
  real-HTTP (supertest) tests.

No other files were modified. No production, staging, or shared
infrastructure was touched.

## Warehouse Isolation — Verified

| Actor (assignment)              | Calgary | Ontario | Maple Ridge | Global |
|----------------------------------|:-------:|:-------:|:-----------:|:------:|
| Staff (Calgary only)             |   200   |   403   |     403      |  200   |
| Driver (Maple Ridge only)        |   403   |   403   |     200      |  200   |
| Manager (Calgary + Maple Ridge)  |   200   |   403   |     200      |  200   |
| Admin (`warehouses:global_access`) | 200   |   200   |     200      |  200   |

## Division Isolation — Verified

Recycling and Healthcare materials were tested independently at every
facility. Result: division has **no effect** on access — a user authorized
for a warehouse can read both divisions' materials there (matches the
established, pre-existing model; see Fix section). A user unauthorized for
the warehouse is denied for **both** divisions (Calgary staff → Ontario
Recycling: 403; Calgary staff → Ontario Healthcare: 403).

## IDOR Test Result

- Calgary-only user → Ontario material ID (both divisions): **403**, verified no
  material fields present in the response body.
- Ontario-only user (dedicated seeded actor) → Calgary material ID (both
  divisions) and → Maple Ridge material ID: **403**, no leak. Same actor →
  its own Ontario materials: **200**.
- No non-Ontario-assigned actor (staff, manager, or driver) can reach any
  Ontario material: **403** for all three.
- Direct ID tampering sweep (Calgary-only staff against all 4 non-Calgary
  facility/division materials): **403** for every one.
- Nonexistent material ID: **404**, not a bypass or a 200.
- Unauthenticated request: **401**.

**UNAUTHORIZED MATERIAL DETAIL: BLOCKED.**

## Related Endpoints Reviewed

- `GET /materials/:id` — vulnerable, **fixed**.
- `GET /materials` — already scoped, unchanged, still passes all existing
  tests.
- `POST /materials` — already scoped, unchanged.
- `PATCH /materials/:id` — already scoped (checks both old and new
  warehouse), unchanged; internal `findOne` calls swapped to the new
  private `findMaterialOrFail` to avoid a redundant authorization check but
  its own two explicit `assertWarehouseAccess` calls are untouched.
- No `DELETE /materials/:id` route exists in this module.
- No `GET /materials/:id/...` sub-resource routes exist.

## Tests

- `npx jest src/materials`: **12/12 passed**
- `npx jest` (full unit suite): **130/130 passed**
- `npx jest --config ./test/jest-e2e.json`: **34/34 passed** (baseline was
  20/20 on `cfb31c3` before this change — verified by stashing the diff and
  re-running; 14 new material IDOR tests added, 0 removed or weakened)

## TypeScript

`npx tsc --noEmit`: **5 pre-existing errors**, all in
`src/auth/auth.service.spec.ts` and `src/payments/payments.*.spec.ts` — none
in any file this change touched. Confirmed pre-existing by stashing this
diff and re-running against the unmodified `cfb31c3` tree (identical 5
errors, identical locations). No `any`, `@ts-ignore`, `@ts-expect-error`,
and no `tsconfig` changes were introduced.

## Lint

`npx eslint "{src,apps,libs,test}/**/*.ts"`: **0 problems** after one
`--fix` pass for Prettier formatting on the two files this change edited
(whitespace/line-wrap only, no logic change).

## Build

`npm run build` (`nest build`): **succeeded**.

## E2E

Covered by `npx jest --config ./test/jest-e2e.json` above (this repo's
`test:e2e` script) — real HTTP requests via `supertest` against a full Nest
application with an in-memory database, including JWT login, warehouse
membership seeding, and the new IDOR assertions.

## Production Status

**NOT DEPLOYED.** No production host, database, cache, storage, or
management portal was accessed or modified. Nothing was pushed or merged.

## Documentation Note (separate issue, not fixed here)

`backend/docs/DEPLOYMENT.md` still documents building/deploying
`backend/app/web` (a Vite/React app) as the production frontend. The
repository root contains a vanilla JS app (`index.html`, `sw.js`,
`assets/`) that appears to be the actual canonical production frontend per
the prior audit's finding. Per instructions, this was left unchanged and is
reported here as a separate, pre-existing documentation issue rather than
folded into this security fix.

## Remaining Issues

- `backend/docs/DEPLOYMENT.md` stale frontend deployment path (see above;
  out of scope for this fix).
- 5 pre-existing `tsc --noEmit` errors in unrelated auth/payments spec
  files (out of scope for this fix; unrelated to material authorization).
