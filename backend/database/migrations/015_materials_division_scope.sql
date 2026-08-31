-- ==============================================================================
-- GreenWave V2 - Migration 015: Materials Division + Warehouse Scope
--
-- Products (materials) must be scoped by division so Recycling and
-- Healthcare catalogs never leak into each other, and optionally pinned to a
-- single warehouse for facility-specific products. Existing rows are
-- backfilled from their current `category` (the only signal we have) and are
-- left warehouse-agnostic (warehouse_id = NULL) since they were created
-- before any per-warehouse concept existed and forcing a single-warehouse
-- guess for them would hide real historical inventory at the other
-- warehouses. New products created after this migration set warehouse_id
-- explicitly. No column is dropped here (SKU never existed on this table).
-- ==============================================================================

ALTER TABLE materials
    ADD COLUMN IF NOT EXISTS division VARCHAR(32) NOT NULL DEFAULT 'recycling',
    ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE materials
SET division = 'healthcare'
WHERE lower(category) = 'healthcare' AND division <> 'healthcare';

CREATE INDEX IF NOT EXISTS idx_materials_division ON materials (division);
CREATE INDEX IF NOT EXISTS idx_materials_warehouse ON materials (warehouse_id);
