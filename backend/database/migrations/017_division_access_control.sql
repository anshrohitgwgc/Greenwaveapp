-- ==============================================================================
-- GreenWave V2 - Migration 017: Division / Business-Unit Access Control
--
-- Division was already a *data* attribute (migrations 013 and 015 put a
-- `division` column on inventory_transactions, containers and materials). It
-- was never an *authorization* boundary: any authenticated user could pass
-- ?division=healthcare and read the other business unit's data.
--
-- This migration adds the missing authorization side, modelled 1:1 on the
-- existing warehouse isolation (`user_warehouses`):
--
--   * `user_divisions` — an explicit grant row per (user, division). No row
--     means no access. There is deliberately no role-derived fallback and no
--     implicit default, so a new account of any role starts with zero
--     divisions until an administrator assigns one.
--   * `customers.division` / `invoices.division` — the two division-scoped
--     business tables that were still missing the column.
--
-- NAMING: the canonical key used by the API and stored in `user_divisions` is
-- `greenwave`. The pre-existing business-data columns store `recycling`, and
-- this migration does NOT rewrite them — renaming live rows is out of scope
-- and unnecessary, because the API translates between the two at its
-- boundary (see src/divisions/divisions.constants.ts). New business rows keep
-- writing `recycling` so they stay consistent with the column DEFAULT.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS TASK.
-- ==============================================================================

-- 1. Division grants -----------------------------------------------------------
--
-- NOTE: the accounts table is `"user"` (singular, quoted) — TypeORM's default
-- name for the User entity, which predates the explicit @Entity({name}) used
-- everywhere else. It must stay quoted; `users` does not exist.

CREATE TABLE IF NOT EXISTS user_divisions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    division    VARCHAR(32) NOT NULL,
    created_by  INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_divisions_user_division_key UNIQUE (user_id, division),
    CONSTRAINT user_divisions_division_check
        CHECK (division IN ('greenwave', 'healthcare'))
);

CREATE INDEX IF NOT EXISTS idx_user_divisions_user ON user_divisions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_divisions_division ON user_divisions (division);

-- 2. Division column on the remaining division-scoped business tables ----------
--
-- Backfilled to 'recycling' rather than left NULL: every customer and invoice
-- that exists today belongs to GreenWave Recycling Inc.'s recycling business,
-- and a NULL would read as "visible to every division", which is the opposite
-- of the isolation this migration exists to create. Existing invoice numbers,
-- amounts and statuses are untouched — this only adds a scoping column.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS division VARCHAR(32) NOT NULL DEFAULT 'recycling';

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS division VARCHAR(32) NOT NULL DEFAULT 'recycling';

CREATE INDEX IF NOT EXISTS idx_customers_division ON customers (division);
CREATE INDEX IF NOT EXISTS idx_invoices_division ON invoices (division);

-- 3. Bootstrap grant -----------------------------------------------------------
--
-- Administrators that already exist are granted both divisions, once. Without
-- this the system becomes unadministrable the moment the migration lands:
-- division access can only be granted by an admin who holds the division, so
-- with an empty table nobody could ever grant anything.
--
-- This is scoped strictly to role = 'admin' and is a one-time, auditable row
-- insert — not a runtime default. Non-admin accounts are intentionally left
-- with zero rows, and every account created after this migration (admins
-- included) starts with no division access.

INSERT INTO user_divisions (user_id, division, created_by)
SELECT u.id, d.division, NULL
  FROM "user" u
 CROSS JOIN (VALUES ('greenwave'), ('healthcare')) AS d(division)
 WHERE u.role = 'admin'
ON CONFLICT (user_id, division) DO NOTHING;

COMMENT ON TABLE user_divisions IS
    'Explicit per-user business-division grants. Absence of a row means no access; there is no role-derived fallback.';
