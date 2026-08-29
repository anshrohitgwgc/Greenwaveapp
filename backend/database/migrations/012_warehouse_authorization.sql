-- ==============================================================================
-- GreenWave V2 - Migration 012: Warehouse Authorization & User-Warehouse Mapping
--
-- Implements clean two-dimensional authorization:
-- ROLE (What a user can do) + WAREHOUSE ACCESS (Where they can do it).
-- Server-authoritative warehouse access mapping via user_warehouses.
-- ==============================================================================

-- 1. Create user_warehouses join table
CREATE TABLE IF NOT EXISTS user_warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_warehouse UNIQUE (user_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_user_warehouses_user ON user_warehouses (user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_warehouse ON user_warehouses (warehouse_id);

-- 2. Add warehouse authorization permissions to RBAC schema
INSERT INTO permissions (key, description) VALUES
    ('warehouses:read_all', 'View all warehouses across the organization'),
    ('warehouses:assign', 'Assign and revoke user warehouse memberships'),
    ('warehouses:global_access', 'Global access capability to all warehouse facilities')
ON CONFLICT (key) DO NOTHING;

-- Grant warehouse assignment and global access to admin role by default
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.key IN ('warehouses:assign', 'warehouses:read_all', 'warehouses:global_access')
ON CONFLICT DO NOTHING;

-- 3. Initial backfill: Assign standard dev/existing users to facilities
-- If user 1 (dev admin) exists, grant access to Calgary, Ontario, and Maple Ridge
INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id
FROM "user" u, warehouses w
WHERE u.email = 'admin@greenwave.local'
ON CONFLICT DO NOTHING;

-- If user 2 (manager) exists, grant access to Calgary and Ontario
INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id
FROM "user" u, warehouses w
WHERE u.email = 'manager@greenwave.local'
  AND w.code IN ('CGY', 'ON')
ON CONFLICT DO NOTHING;

-- If user 3 (staff) exists, grant access to Calgary only
INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id
FROM "user" u, warehouses w
WHERE u.email = 'staff@greenwave.local'
  AND w.code = 'CGY'
ON CONFLICT DO NOTHING;

-- If user 4 (driver) exists, grant access to Calgary and Maple Ridge
INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id
FROM "user" u, warehouses w
WHERE u.email = 'driver@greenwave.local'
  AND w.code IN ('CGY', 'MR')
ON CONFLICT DO NOTHING;
