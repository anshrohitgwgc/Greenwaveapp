# Material Detail IDOR Fix Report

## Problem

`GET /materials/:id` returned the full material record to **any authenticated
user**, regardless of which warehouse (facility) or division the material
belonged to. A Calgary-only user could request an Ontario-only material by ID
and receive the full record (name, category, description, price, division,
warehouse, etc.).

`findAll`, `create`, and `update` were already correctly scoped — only the
single-record lookup was missing the check.

## Root Cause

`MaterialsController.findOne` did not accept the authenticated actor and
called `MaterialsService.findOne(id)`, which ran an unscoped lookup:

```ts
// backend/app/api/src/materials/materials.service.ts (before)
async findOne(id: string) {
  const material = await this.materialRepository.findOne({ where: { id } });
  if (!material) throw new NotFoundException('Material not found');
  return material;
}
```

This is exactly the `findOne({ where: { id } })` pattern the audit flagged as
unsafe: it never asked whether the caller was authorized for the material's
`warehouseId`.

## Affected Endpoint

- `GET /materials/:id` — vulnerable (fixed).

Reviewed and confirmed **not** affected (already scoped, unchanged):

- `GET /materials` (`findAll`) — resolves the actor's authorized warehouse
  IDs via `WarehousesService` and filters the query by them.
- `POST /materials` (`create`) — calls `assertWarehouseAccess` on the target
  warehouse before creating.
- `PATCH /materials/:id` (`update`) — calls `assertWarehouseAccess` against
  both the material's current warehouse and any new `warehouseId` in the
  update payload.
- There is no `DELETE /materials/:id` route in this module.

## Authorization Model (existing, reused — not reinvented)

The codebase's warehouse authorization is centralized in
`WarehousesService`:

- `assertWarehouseAccess(actor, warehouseId)` throws `ForbiddenException`
  (403) unless the actor has the `warehouses:global_access` permission or an
  explicit `UserWarehouse` membership row for that warehouse. A `null`/falsy
  `warehouseId` is treated as globally accessible.
- `getUserAuthorizedWarehouseIds(...)` returns the set of warehouse IDs an
  actor may see, used by `findAll` to scope list queries.

**There is no separate division-level permission** anywhere in this codebase
(warehouses, inventory, or materials modules). `division` (`recycling` /
`healthcare`) is a data attribute used for filtering and business-rule
validation (e.g. healthcare uses boxes, recycling uses pallets/weight), not
an independent access-control boundary. `findAll`'s existing division filter
is a *query filter*, not an authorization gate — confirmed by reading
`inventory.service.ts`, which has the same pattern and no division-based
`ForbiddenException`. The fix reuses this exact model rather than inventing a
second permission system for materials.

Given that, "Calgary-only staff requesting Calgary Healthcare material" is
**allowed (200)** — the user is authorized for the Calgary warehouse, and
division is not a separate boundary in this app's established model.

## Fix

`backend/app/api/src/materials/materials.service.ts`:

- Split the old unscoped `findOne` into a private `findMaterialOrFail(id)`
  (existence check only, still throws `NotFoundException`) and a public
  `findOne(id, actor)` that fetches the record and then calls
  `warehousesService.assertWarehouseAccess(actor, material.warehouseId)`
  before returning it — the same call `update` already made against the
  existing record.
- `update` now uses `findMaterialOrFail` internally for its two existing
  lookups (initial fetch and post-update refetch); its own two explicit
  `assertWarehouseAccess` calls (current warehouse + any new warehouse from
  the DTO) are unchanged.

`backend/app/api/src/materials/materials.controller.ts`:

- `findOne` now takes `@CurrentUser() actor: AuthenticatedUser` and passes it
  through: `this.materialsService.findOne(id, actor)`.

### Before

```ts
// controller
@Get(':id')
findOne(@Param('id') id: string) {
  return this.materialsService.findOne(id);
}

// service
async findOne(id: string) {
  const material = await this.materialRepository.findOne({ where: { id } });
  if (!material) throw new NotFoundException('Material not found');
  return material;
}
```

### After

```ts
// controller
@Get(':id')
findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
  return this.materialsService.findOne(id, actor);
}

// service
private async findMaterialOrFail(id: string) {
  const material = await this.materialRepository.findOne({ where: { id } });
  if (!material) throw new NotFoundException('Material not found');
  return material;
}

async findOne(id: string, actor: AuthenticatedUser) {
  const material = await this.findMaterialOrFail(id);
  await this.warehousesService.assertWarehouseAccess(actor, material.warehouseId);
  return material;
}
```

### Information disclosure decision

Unauthorized access returns **403 Forbidden** (via `ForbiddenException` from
`assertWarehouseAccess`), matching the app's existing convention — the same
convention `findAll`, `create`, `update`, and `GET /warehouses/:id` already
use. This app does not use a "404 to prevent enumeration" pattern anywhere
in the warehouse/material access path, so 403 is the correct, consistent
choice rather than a new pattern. A genuinely nonexistent material ID still
returns `404 Material not found` (checked before the authorization check,
so existence-checking happens first — consistent with `update`'s existing
order of operations).

## Tests

### Unit tests — `materials.service.spec.ts`

Added a `findOne — single-record IDOR guard` block:

1. Authorized actor → material returned, `assertWarehouseAccess` called with
   the material's `warehouseId`.
2. Unauthorized warehouse → `ForbiddenException` propagates.
3. Denied response contains no material fields (only the standard Nest
   `ForbiddenException` body).
4. Global (`warehouseId: null`) material → accessible regardless of the
   actor's warehouse assignments.
5. Nonexistent ID → `NotFoundException`, and `assertWarehouseAccess` is
   **not** called (existence is checked first).

All pre-existing tests in this file (`findAll`, `create`, `update` isolation
checks) were left unchanged and still pass.

### IDOR / E2E tests — `test/payment-rbac.e2e-spec.ts`

Reused the existing in-memory (better-sqlite3) Nest app harness and its
Calgary/Ontario/Maple Ridge warehouse + admin/manager/staff/driver token
setup. Seeded one Recycling + one Healthcare material per facility, plus one
global material, and added a new `2b. Material Detail IDOR Defense (GET
/materials/:id)` block:

1. Calgary-only staff → Calgary Recycling material → 200.
2. Calgary-only staff → Calgary Healthcare material → 200 (division is not a
   separate boundary in this app's model).
3. Calgary-only staff → Ontario Recycling material → 403, response body has
   no `name`/`warehouseId`/`division`/`category`.
4. Calgary-only staff → Ontario Healthcare material → 403, no leak.
5. Calgary-only staff → Maple Ridge material → 403.
6. Ontario material is 403 for staff, manager, and driver (none assigned to
   Ontario).
7. Maple Ridge driver → Maple Ridge material → 200; same driver → Calgary
   material → 403.
8. Manager (Calgary + Maple Ridge) → both → 200; → Ontario → 403.
9. Admin (`warehouses:global_access`) → every facility → 200.
10. Any authenticated actor → global material → 200.
11. No token → 401.
12. Nonexistent ID → 404 (not a bypass).
13. Direct ID tampering sweep: Calgary-only staff against all four
    non-Calgary facility/division materials → 403 for every one.
14. Reverse direction: an Ontario-only staff user (seeded separately) can
    retrieve both Ontario Recycling and Ontario Healthcare (200) but is
    denied Calgary and Maple Ridge materials by direct ID (403, no leak).

## Results

- `npx jest src/materials` — **12/12 passed**
- `npx jest --config ./test/jest-e2e.json` — **34/34 passed** (was 20 before
  this change; 14 new material IDOR tests added, 0 removed/weakened)
- `npx jest` (full unit suite) — **130/130 passed**
- `npx eslint "{src,apps,libs,test}/**/*.ts"` — **0 problems** (ran
  `--fix` once for prettier formatting on the two files this change touched;
  no logic changes from the auto-fix)
- `npm run build` (`nest build`) — **succeeded**
- `npx tsc --noEmit` — **5 pre-existing errors**, all in
  `auth.service.spec.ts` and `payments.service.spec.ts` /
  `payments.controller.spec.ts`, none in any file touched by this change.
  Confirmed pre-existing by stashing this diff and re-running `tsc --noEmit`
  against the unmodified `cfb31c3` tree — identical 5 errors. No `any`,
  `@ts-ignore`, or `@ts-expect-error` were introduced by this change.
