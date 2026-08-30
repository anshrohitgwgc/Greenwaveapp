-- ==============================================================================
-- GreenWave V2 - Migration 014: User Status & Invoice Payment Infrastructure
--
-- 1. Adds user status and last_login_at to "user" table
-- 2. Adds payment fields to "invoices" table
-- 3. Creates "payments" table for authoritative payment tracking
-- 4. Seeds payment permissions into RBAC schema
-- ==============================================================================

-- 1. Add status and last_login_at to "user"
ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_user_status ON "user" (status);

-- 2. Add payment fields and currency to "invoices"
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS payment_token VARCHAR(64) UNIQUE,
ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'CAD',
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(32),
ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices (payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_token ON invoices (payment_token);

-- 3. Create payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'stripe',
    provider_payment_id VARCHAR(128),
    provider_checkout_id VARCHAR(128),
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'CAD',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    metadata JSONB,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_checkout ON payments (provider_checkout_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments (provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_warehouse ON payments (warehouse_id);

-- 4. Seed payment permissions into RBAC schema
INSERT INTO permissions (key, description) VALUES
    ('payments:manage', 'Generate payment links, record payments, and manage invoices payments'),
    ('payments:read_all', 'View payment metrics and payment history across facilities'),
    ('payments:refund', 'Process payment refunds')
ON CONFLICT (key) DO NOTHING;

-- Grant payment permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.key IN ('payments:manage', 'payments:read_all', 'payments:refund')
ON CONFLICT DO NOTHING;

-- Grant payment manage/read permissions to manager role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager'
  AND p.key IN ('payments:manage', 'payments:read_all')
ON CONFLICT DO NOTHING;
