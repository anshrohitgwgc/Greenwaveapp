-- ==============================================================================
-- GreenWave V2 - Migration 005: RBAC schema (roles, permissions,
-- role_permissions, user_roles)
--
-- `user.role` remains the fast-path column every guard actually checks
-- (see docs/V2_ARCHITECTURE.md §4) — these tables make the richer role/
-- permission model queryable without a breaking rewrite of existing auth.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(32) UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

INSERT INTO roles (name, description) VALUES
    ('admin', 'Full access: staff, settings, invoices, customers, materials, history, inventory, photos, clock'),
    ('manager', 'Invoices, customers, materials, history, inventory, photos, clock'),
    ('staff', 'Inventory, weigh-in/receive, photos, clock')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
    ('invoices:manage', 'Create, edit, duplicate invoices'),
    ('customers:manage', 'Create and edit customers'),
    ('materials:manage', 'Create and edit materials'),
    ('inventory:write', 'Record inbound/outbound inventory transactions'),
    ('inventory:adjust', 'Record inventory adjustments (requires reason)'),
    ('photos:read_all', 'View photos uploaded by any staff member'),
    ('photos:delete', 'Delete uploaded photos'),
    ('staff:manage', 'Create and manage staff accounts and roles'),
    ('audit:read', 'View the audit/history log'),
    ('warehouses:manage', 'Create and edit warehouses')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager'
  AND p.key IN ('invoices:manage', 'customers:manage', 'materials:manage', 'inventory:write', 'inventory:adjust', 'photos:read_all', 'audit:read', 'warehouses:manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'staff'
  AND p.key IN ('inventory:write')
ON CONFLICT DO NOTHING;

-- Backfill user_roles for any users that already exist, matching their
-- current `role` column (admin/manager/staff — 'driver' has no roles-table
-- row and is intentionally left unlinked, it's handled as a STAFF-tier
-- alias in the application's RolesGuard rather than in this schema).
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM "user" u JOIN roles r ON r.name = u.role
ON CONFLICT DO NOTHING;
