-- ==============================================================================
-- GreenWave V2 - Migration 006: Warehouses, customers, materials
-- ==============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(32) UNIQUE NOT NULL,
    province VARCHAR(8),
    address TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    company_info JSONB,
    bill_to TEXT,
    ship_to TEXT,
    email VARCHAR(255),
    phone VARCHAR(64),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_warehouse ON customers (warehouse_id);

CREATE TABLE IF NOT EXISTS materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(32) NOT NULL DEFAULT 'kg',
    category VARCHAR(100),
    default_price NUMERIC(12, 4),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
