-- ==============================================================================
-- GreenWave V2 - Migration 013: Inventory Weight, Division Rules, Unit Types,
-- Transaction Photos, and Invoice 1114 Reference Fields
-- ==============================================================================

-- 1. Enhanced Inventory Transactions
ALTER TABLE inventory_transactions
    ADD COLUMN IF NOT EXISTS unit_type VARCHAR(32) DEFAULT 'pallet',
    ADD COLUMN IF NOT EXISTS division VARCHAR(32) DEFAULT 'recycling',
    ADD COLUMN IF NOT EXISTS weight_value NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(8),
    ADD COLUMN IF NOT EXISTS photo_id UUID;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_division ON inventory_transactions (division);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_unit_type ON inventory_transactions (unit_type);

-- 2. Enhanced Containers
ALTER TABLE containers
    ADD COLUMN IF NOT EXISTS unit_type VARCHAR(32) DEFAULT 'pallet',
    ADD COLUMN IF NOT EXISTS division VARCHAR(32) DEFAULT 'recycling',
    ADD COLUMN IF NOT EXISTS weight_value NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(8),
    ADD COLUMN IF NOT EXISTS photo_id UUID;

-- 3. Invoices Table Enhancements for Invoice 1114
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS ship_via VARCHAR(150) DEFAULT 'Greenwave Recycling Truck',
    ADD COLUMN IF NOT EXISTS ship_date DATE;

-- 4. Invoice Items Table Enhancements for Invoice 1114
ALTER TABLE invoice_items
    ADD COLUMN IF NOT EXISTS service_date DATE,
    ADD COLUMN IF NOT EXISTS product_service VARCHAR(100) DEFAULT 'supply',
    ADD COLUMN IF NOT EXISTS tax_rate_label VARCHAR(32) DEFAULT 'GST';
