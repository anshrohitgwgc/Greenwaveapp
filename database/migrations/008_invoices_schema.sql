-- ==============================================================================
-- GreenWave V2 - Migration 008: Invoices & invoice line items
-- ==============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(32) UNIQUE NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    company_info JSONB,
    bill_to TEXT,
    ship_to TEXT,
    po_reference VARCHAR(100),
    payment_terms VARCHAR(100),
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    discount_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_label VARCHAR(32),
    tax_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,
    tax_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    terms TEXT,
    footer TEXT,
    payment_instructions TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    created_by INTEGER NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    updated_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_warehouse ON invoices (warehouse_id);

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL,
    unit VARCHAR(32),
    unit_price NUMERIC(12, 4) NOT NULL,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_rebate BOOLEAN NOT NULL DEFAULT FALSE,
    line_total NUMERIC(12, 2) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);
