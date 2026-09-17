-- ==============================================================================
-- GreenWave V2 - Migration 024: Proforma Invoices Architecture
--
-- Introduces dedicated, isolated non-accounting Proforma Invoices for the
-- GreenWave Recycling division.
--
-- Safety and Accounting Isolation:
-- 1. Dedicated tables: proforma_invoices and proforma_invoice_items.
-- 2. Concurrency-safe sequence: proforma_invoice_number_seq starting at 1 (PF-0001).
-- 3. Independent of real invoices (invoice_number_seq is never touched until conversion).
-- 4. 0 Accounts Receivable postings, 0 journal entries, 0 ledger lines, 0 Stripe payments.
-- 5. Convertible once to final invoice transactionally with audit trail.
-- ==============================================================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS proforma_invoice_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS proforma_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proforma_number VARCHAR(32) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255),
    division VARCHAR(32) NOT NULL DEFAULT 'recycling',
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    issue_date DATE NOT NULL,
    validity_date DATE,
    currency VARCHAR(8) NOT NULL DEFAULT 'CAD',
    po_reference VARCHAR(100),
    bill_to TEXT,
    ship_to TEXT,
    origin VARCHAR(150),
    destination VARCHAR(150),
    incoterm VARCHAR(16),
    incoterm_location VARCHAR(150),
    shipping_terms VARCHAR(150),
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_weight NUMERIC(12, 3),
    weight_unit VARCHAR(16) NOT NULL DEFAULT 'kg',
    notes TEXT,
    commercial_terms TEXT,
    internal_notes TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    converted_at TIMESTAMP WITH TIME ZONE,
    converted_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_by INTEGER NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_proforma_division CHECK (division IN ('recycling', 'greenwave')),
    CONSTRAINT chk_proforma_status CHECK (status IN ('draft', 'sent', 'accepted', 'expired', 'converted', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_proforma_customer ON proforma_invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_proforma_warehouse ON proforma_invoices (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_proforma_status ON proforma_invoices (status);
CREATE INDEX IF NOT EXISTS idx_proforma_converted ON proforma_invoices (converted_invoice_id);

CREATE TABLE IF NOT EXISTS proforma_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proforma_invoice_id UUID NOT NULL REFERENCES proforma_invoices(id) ON DELETE CASCADE,
    material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL,
    unit VARCHAR(32) NOT NULL DEFAULT 'kg',
    unit_price NUMERIC(12, 4) NOT NULL,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(7, 4) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL,
    weight NUMERIC(12, 3),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proforma_items_invoice ON proforma_invoice_items (proforma_invoice_id);

COMMIT;
