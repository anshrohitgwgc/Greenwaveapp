-- ==============================================================================
-- GreenWave V2 - Migration 018: Purchase Orders, line items & PO numbering
--
-- Adds the Purchase Order document type. A PO is NOT an invoice: it is issued
-- *by* GreenWave *to* a supplier, carries its own numbering series, and has a
-- resin-trading line-item shape (code / resin / description / colour) that the
-- invoice tables have no columns for. It therefore gets its own tables rather
-- than overloading `invoices`.
--
-- Numbering follows the pattern established by migration 016 for invoices: a
-- native PostgreSQL SEQUENCE rather than a counter row or COUNT(*)+1.
--
--   * `nextval()` is atomic and non-transactional, so two admins creating a PO
--     at the same instant can never receive the same number -- no row lock, no
--     retry loop.
--   * Because allocations are never rolled back, an issued number is never
--     handed out a second time. Deleting a purchase order therefore does NOT
--     release its number for reuse: the series continues from the highest
--     value ever allocated. Gaps are acceptable; duplicates are not.
--
-- The series starts at 1 and is rendered `PO-0001` by the API (zero-padded to
-- four digits, widening naturally past PO-9999).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Rendered document number, e.g. 'PO-0001'. Unique so a duplicate can
    -- never be persisted even if the sequence were somehow bypassed.
    po_number VARCHAR(32) UNIQUE NOT NULL,
    -- The raw sequence value behind po_number. Kept as its own column so the
    -- series can be resumed correctly (see the setval below) without having
    -- to parse the formatted string.
    sequence_number BIGINT UNIQUE NOT NULL,

    order_date DATE NOT NULL,
    expected_date DATE,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',

    supplier_name VARCHAR(200) NOT NULL,
    supplier_address TEXT,
    supplier_city VARCHAR(120),
    supplier_province VARCHAR(120),
    supplier_postal_code VARCHAR(32),
    supplier_country VARCHAR(120),
    supplier_phone VARCHAR(64),
    supplier_email VARCHAR(200),

    -- Letterhead snapshot, mirroring invoices.company_info: the backend has no
    -- company-settings table, so each document stores what was on screen when
    -- it was saved.
    company_info JSONB,

    notes TEXT,

    total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- The "Date: ____________" signature line at the foot of the document.
    -- Free text/date, distinct from order_date.
    footer_date DATE,

    status VARCHAR(16) NOT NULL DEFAULT 'draft',

    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    -- Business division, same scoping rule as invoices (migration 017).
    division VARCHAR(32) NOT NULL DEFAULT 'recycling',

    created_by INTEGER NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    updated_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_division ON purchase_orders (division);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_warehouse ON purchase_orders (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

    code VARCHAR(64),
    resin VARCHAR(64),
    description TEXT NOT NULL,
    color VARCHAR(64),

    -- Quantities on a resin PO are weights (e.g. 54 850 lbs), so this is
    -- deliberately wider than invoice_items.quantity NUMERIC(12,3).
    quantity NUMERIC(14, 3) NOT NULL,
    unit VARCHAR(32),
    unit_price NUMERIC(12, 4) NOT NULL,
    -- Always recomputed server-side as quantity * unit_price; never trusted
    -- from the client.
    amount NUMERIC(14, 2) NOT NULL,

    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items (purchase_order_id);

-- ------------------------------------------------------------------------------
-- PO numbering sequence
-- ------------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO CYCLE;

-- Resume above the highest number ever allocated, so re-running this migration
-- (or importing data) can never re-issue a number and violate the UNIQUE
-- constraints above.
--
-- The guard matters: `setval(seq, 0, true)` is illegal when MINVALUE is 1, and
-- a fresh install has nothing to resume from. Skipping setval entirely in that
-- case leaves the untouched sequence to hand out exactly 1 -- i.e. PO-0001 --
-- on the first nextval(). `pg_sequence_last_value` returns NULL until the
-- first nextval(), which is what makes that fresh-install branch detectable.
SELECT setval('purchase_order_number_seq', resume_from, true)
  FROM (
    SELECT GREATEST(
             COALESCE((SELECT MAX(sequence_number) FROM purchase_orders), 0),
             COALESCE(pg_sequence_last_value('purchase_order_number_seq'), 0)
           ) AS resume_from
  ) s
 WHERE resume_from >= 1;
