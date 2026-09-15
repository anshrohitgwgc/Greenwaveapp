-- ==============================================================================
-- GreenWave V2 - Migration 011: Global Staff Chat, Multi-Warehouse Facilities,
-- Enhanced Inventory Transaction & Container Tracking, and Per-Size Balances
-- ==============================================================================

-- 1. Global Staff Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    sender_name VARCHAR(255) NOT NULL,
    sender_role VARCHAR(32) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (sender_id);

-- 2. Enhanced Inventory Transactions Columns
ALTER TABLE inventory_transactions
    ADD COLUMN IF NOT EXISTS order_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS container_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS seal_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_order_num ON inventory_transactions (order_number);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_container_num ON inventory_transactions (container_number);

-- 3. Enhanced Containers Tracking Columns
ALTER TABLE containers
    ADD COLUMN IF NOT EXISTS product_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS xl NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS l NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS m NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS s NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total NUMERIC(12, 3) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_containers_container_num ON containers (container_number);
CREATE INDEX IF NOT EXISTS idx_containers_seal_num ON containers (seal_number);

-- 4. Update Inventory Balances View with Per-Size Calculations
CREATE OR REPLACE VIEW inventory_balances AS
SELECT
    warehouse_id,
    material_id,
    SUM(CASE
        WHEN type = 'inbound' THEN xl
        WHEN type = 'outbound' THEN -xl
        WHEN type = 'adjustment' THEN xl
        ELSE 0
    END) AS xl_balance,
    SUM(CASE
        WHEN type = 'inbound' THEN l
        WHEN type = 'outbound' THEN -l
        WHEN type = 'adjustment' THEN l
        ELSE 0
    END) AS l_balance,
    SUM(CASE
        WHEN type = 'inbound' THEN m
        WHEN type = 'outbound' THEN -m
        WHEN type = 'adjustment' THEN m
        ELSE 0
    END) AS m_balance,
    SUM(CASE
        WHEN type = 'inbound' THEN s
        WHEN type = 'outbound' THEN -s
        WHEN type = 'adjustment' THEN s
        ELSE 0
    END) AS s_balance,
    SUM(CASE
        WHEN type = 'inbound' THEN total
        WHEN type = 'outbound' THEN -total
        WHEN type = 'adjustment' THEN total
        ELSE 0
    END) AS balance,
    SUM(CASE
        WHEN type = 'inbound' THEN total
        ELSE 0
    END) AS inbound_total,
    SUM(CASE
        WHEN type = 'outbound' THEN total
        ELSE 0
    END) AS outbound_total,
    SUM(CASE
        WHEN type = 'adjustment' THEN total
        ELSE 0
    END) AS adjustment_total
FROM inventory_transactions
GROUP BY warehouse_id, material_id;

-- 5. Standard Facilities Seed / Upsert
INSERT INTO warehouses (id, name, code, province, address, active)
VALUES
    ('22222222-2222-4222-8222-222222222222', 'Calgary, AB', 'CGY', 'AB', '456 Warehouse Rd, Calgary, AB', TRUE),
    ('33333333-3333-4333-8333-333333333333', 'Ontario', 'ON', 'ON', '789 Depot Ave, Toronto, ON', TRUE),
    ('11111111-1111-4111-8111-111111111111', 'Maple Ridge, BC', 'MR', 'BC', '123 Industrial Way, Maple Ridge, BC', TRUE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    code = EXCLUDED.code,
    province = EXCLUDED.province,
    active = EXCLUDED.active;

-- 6. Add Chat Permissions into RBAC
INSERT INTO permissions (key, description) VALUES
    ('chat:read', 'View global staff chat messages'),
    ('chat:write', 'Send global staff chat messages')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('admin', 'manager', 'staff')
  AND p.key IN ('chat:read', 'chat:write')
ON CONFLICT DO NOTHING;
