# GreenWave Operations Platform — Server-Authoritative Warehouse Authorization

## 1. Overview & Architecture

Warehouse authorization in the GreenWave Operations Platform is **strictly server-authoritative**. The frontend is an ergonomic presentation layer; access boundaries, data isolation, and API operations are validated on every request in the NestJS application layer and verified against the relational database schema.

### Core Authorization Principles
1. **Zero Implicit Access**: Having a role (such as `staff` or `driver` or `manager`) confers permission to perform actions, but *only* within warehouse facilities explicitly assigned to that user in `user_warehouses`.
2. **Explicit Global Access Flag**: Only users possessing the `warehouses:global_access` permission (by default, system administrators) can interact across all facilities without individual membership entries.
3. **No Unchecked Admin Pass-Through**: An `admin` user without `warehouses:global_access` is constrained to their explicitly assigned facilities in `user_warehouses`. Direct requests to unassigned facilities yield `403 Forbidden`.
4. **Authoritative 403 Rejection**: Any attempt to read or modify data in an unassigned warehouse (via query param tampering, body manipulation, or route tampering) returns `403 Forbidden`.

```
                  ┌──────────────────────────────────────────────┐
                  │                 Incoming JWT                 │
                  │   { id, email, role, permissions, ... }      │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │     WarehousesService.assertWarehouseAccess   │
                  └──────────────────────┬───────────────────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     │                                       │
     Has `warehouses:global_access`?            Direct Join `user_warehouses`
                     │                                       │
            ┌────────┴────────┐                     ┌────────┴────────┐
           YES                NO                   YES                NO
            │                 │                     │                 │
            ▼                 ▼                     ▼                 ▼
        [ Allow ]     Check `user_warehouses`   [ Allow ]       [ 403 Forbidden ]
```

---

## 2. Database Schema & Migration (`012_warehouse_authorization.sql`)

### Join Table: `user_warehouses`
```sql
CREATE TABLE IF NOT EXISTS user_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_warehouses_user_wh UNIQUE (user_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_user_warehouses_user_id ON user_warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_warehouse_id ON user_warehouses(warehouse_id);
```

### New Permissions Seeded
- `warehouses:read_all`: View all warehouse facilities in management listings.
- `warehouses:assign`: Assign and update facility memberships for staff.
- `warehouses:global_access`: Access inventory, ledger, containers, and invoices across all facilities without per-facility join records.

---

## 3. Server-Side Domain Enforcement Matrix

Every warehouse-sensitive domain enforces `WarehousesService.assertWarehouseAccess(actor, targetWarehouseId)`:

| Domain | Sensitive Endpoints | Enforcement Method | Unauthorized Result |
| :--- | :--- | :--- | :--- |
| **Warehouses** | `GET /warehouses/:id` | `assertWarehouseAccess` | `403 Forbidden` |
| **Warehouses** | `GET /warehouses` | Scoped to authorized facilities | Only authorized rows returned |
| **Inventory Balances** | `GET /inventory/balances` | `assertWarehouseAccess` (if specified) or IN filter | `403 Forbidden` if unassigned |
| **Inventory Transactions** | `GET /inventory/transactions`<br>`POST /inventory/transactions` | `assertWarehouseAccess(actor, dto.warehouseId)` | `403 Forbidden` |
| **Containers** | `GET /containers`<br>`POST /containers` | `assertWarehouseAccess(actor, dto.warehouseId)` | `403 Forbidden` |
| **Invoices** | `GET /invoices`<br>`POST /invoices`<br>`GET /invoices/:id`<br>`PATCH /invoices/:id` | `assertWarehouseAccess(actor, invoice.warehouseId)` | `403 Forbidden` |
| **Photos** | `GET /photos`<br>`POST /photos`<br>`GET /photos/:id`<br>`DELETE /photos/:id` | `assertWarehouseAccess(actor, photo.warehouseId)` + IDOR check | `403 Forbidden` |
| **Timesheets** | `POST /timesheets/clock-in`<br>`GET /timesheets/team` | `assertWarehouseAccess(actor, dto.warehouseId)` | `403 Forbidden` |
| **Customers** | `GET /customers`<br>`POST /customers`<br>`PATCH /customers/:id` | `assertWarehouseAccess(actor, customer.warehouseId)` | `403 Forbidden` |
| **Audit Logs** | `GET /audit?warehouseId=...` | `assertWarehouseAccess(actor, warehouseId)` | `403 Forbidden` |

---

## 4. User Membership Management Endpoints

Administrators manage user warehouse access via REST endpoints:
- `GET /users/:id/warehouses`: Lists warehouses authorized for user `:id`.
- `PUT /users/:id/warehouses`: Sets authorized warehouses for user `:id` (`{ "warehouseIds": ["uuid1", "uuid2"] }`).
- `POST /users`: Accepts optional initial `warehouseIds` array on user creation.
- `PATCH /users/:id`: Accepts optional `warehouseIds` array on user update.

---

## 5. Security Test Matrix

The test matrix in `backend/app/api/src/auth/warehouse-authorization.integration.spec.ts` and `backend/tests/security/warehouse-authorization-matrix.test.ts` executes and validates all access permutations:

1. `STAFF + unauthorized warehouse` → `403 Forbidden`
2. `DRIVER + unauthorized warehouse` → `403 Forbidden`
3. `MANAGER + unauthorized warehouse` → `403 Forbidden`
4. `ADMIN + authorized warehouse` → `200 OK`
5. `ADMIN without global permission + unauthorized warehouse` → `403 Forbidden`
6. `Multi-warehouse user + assigned warehouse` → `200 OK`
7. `Multi-warehouse user + unassigned warehouse` → `403 Forbidden`
8. `Direct API warehouse tampering` → `403 Forbidden` across all 9 sensitive domain endpoints.
9. `Cross-Warehouse Data Isolation` → Records `TEST-CGY`, `TEST-ON`, and `TEST-MR` are isolated at the database, query runner, and API layer.
