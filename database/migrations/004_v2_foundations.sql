-- ==============================================================================
-- GreenWave V2 - Migration 004: Foundations (extensions, user.updatedAt,
-- invoice numbering counter)
--
-- NOTE before running this against any real database that was originally
-- bootstrapped via TypeORM `synchronize: true` rather than these migration
-- files: verify actual live table/column names first (they may differ in
-- casing from what's below). See docs/V2_DEPLOYMENT_PLAN.md.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Server-authoritative, collision-safe invoice numbering. Seeded to 1115 so
-- numbering continues from the existing production sequence, which the
-- Greenwaveapp frontend's README documents as running through 1114.
CREATE TABLE IF NOT EXISTS invoice_number_counter (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    next_value INTEGER NOT NULL,
    CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO invoice_number_counter (id, next_value)
VALUES (1, 1115)
ON CONFLICT (id) DO NOTHING;
