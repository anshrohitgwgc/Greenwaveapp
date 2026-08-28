-- ==============================================================================
-- GreenWave V2 - Migration 007: Containers, inventory transactions (ledger),
-- and the derived inventory_balances view.
--
-- Inventory is append-only: there is no editable "stock total" column
-- anywhere. Current stock is always computed from the transaction ledger.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    order_number VARCHAR(100),
    bl_number VARCHAR(100),
    shipping_line VARCHAR(150),
    container_number VARCHAR(100),
    seal_number VARCHAR(100),
    eta DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'in_transit',
    notes TEXT,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_containers_warehouse ON containers (warehouse_id);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    container_id UUID REFERENCES containers(id) ON DELETE SET NULL,
    type VARCHAR(16) NOT NULL CHECK (type IN ('inbound', 'outbound', 'adjustment')),
    xl NUMERIC(12, 3) NOT NULL DEFAULT 0,
    l NUMERIC(12, 3) NOT NULL DEFAULT 0,
    m NUMERIC(12, 3) NOT NULL DEFAULT 0,
    s NUMERIC(12, 3) NOT NULL DEFAULT 0,
    total NUMERIC(12, 3) NOT NULL,
    reason TEXT,
    reference VARCHAR(100),
    created_by INTEGER NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT adjustment_requires_reason CHECK (type <> 'adjustment' OR reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_inventory_tx_warehouse ON inventory_transactions (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_material ON inventory_transactions (material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_warehouse_material ON inventory_transactions (warehouse_id, material_id);

CREATE OR REPLACE VIEW inventory_balances AS
SELECT
    warehouse_id,
    material_id,
    SUM(CASE
        WHEN type = 'inbound' THEN total
        WHEN type = 'outbound' THEN -total
        WHEN type = 'adjustment' THEN total
        ELSE 0
    END) AS balance
FROM inventory_transactions
GROUP BY warehouse_id, material_id;
