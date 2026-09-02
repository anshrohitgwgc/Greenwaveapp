-- ==============================================================================
-- GreenWave Local Development Fixtures: Division Access Control
-- MOCK DATA FOR LOCAL DEVELOPMENT ONLY - NOT FOR PRODUCTION
--
-- Provides the full warehouse x division matrix so isolation can be tested
-- against real data:
--
--     Calgary     + GreenWave      Calgary     + Healthcare
--     Ontario     + GreenWave      Ontario     + Healthcare
--     Maple Ridge + GreenWave      Maple Ridge + Healthcare
--
-- plus one account per access shape (GreenWave-only, Healthcare-only,
-- both, and a deliberately unassigned account).
--
-- Standard local dev password for every account below: "DevPassword123!"
-- ==============================================================================

-- 1. Division grants for the existing dev accounts ----------------------------
--
-- Migration 017 bootstraps admins only. The other seeded dev accounts are
-- given GreenWave so the existing local workflows keep working; the
-- division-specific personas below are what the isolation testing uses.

INSERT INTO user_divisions (user_id, division, created_by)
SELECT u.id, 'greenwave', NULL
  FROM "user" u
 WHERE u.email IN (
    'manager@greenwave.local',
    'staff@greenwave.local',
    'driver@greenwave.local'
 )
ON CONFLICT (user_id, division) DO NOTHING;

-- 2. Division persona accounts ------------------------------------------------

INSERT INTO "user" ("fullName", email, password, role, status, "createdAt", "updatedAt")
VALUES
    ('GreenWave Only (Dev Mock)',  'gw.only@greenwave.local',    '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'manager', 'active', NOW(), NOW()),
    ('Healthcare Only (Dev Mock)', 'hc.only@greenwave.local',    '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'manager', 'active', NOW(), NOW()),
    ('Both Divisions (Dev Mock)',  'both.admin@greenwave.local', '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'admin',   'active', NOW(), NOW()),
    -- Intentionally left with NO division grant, to exercise the
    -- "new staff sees nothing until an admin assigns" path.
    ('Unassigned Hire (Dev Mock)', 'unassigned@greenwave.local', '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'staff',   'active', NOW(), NOW())
ON CONFLICT (email) DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    password   = EXCLUDED.password,
    role       = EXCLUDED.role,
    status     = EXCLUDED.status;

-- GreenWave-only manager: Calgary + Ontario
INSERT INTO user_divisions (user_id, division, created_by)
SELECT id, 'greenwave', NULL FROM "user" WHERE email = 'gw.only@greenwave.local'
ON CONFLICT (user_id, division) DO NOTHING;

INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id
  FROM "user" u, warehouses w
 WHERE u.email = 'gw.only@greenwave.local'
   AND w.code IN ('CGY', 'ON')
ON CONFLICT (user_id, warehouse_id) DO NOTHING;

-- Healthcare-only manager: Maple Ridge only
INSERT INTO user_divisions (user_id, division, created_by)
SELECT id, 'healthcare', NULL FROM "user" WHERE email = 'hc.only@greenwave.local'
ON CONFLICT (user_id, division) DO NOTHING;

INSERT INTO user_warehouses (user_id, warehouse_id)
SELECT u.id, w.id
  FROM "user" u, warehouses w
 WHERE u.email = 'hc.only@greenwave.local'
   AND w.code = 'MR'
ON CONFLICT (user_id, warehouse_id) DO NOTHING;

-- Both-divisions admin (warehouse access comes from warehouses:global_access)
INSERT INTO user_divisions (user_id, division, created_by)
SELECT u.id, d.division, NULL
  FROM "user" u
 CROSS JOIN (VALUES ('greenwave'), ('healthcare')) AS d(division)
 WHERE u.email = 'both.admin@greenwave.local'
ON CONFLICT (user_id, division) DO NOTHING;

-- 3. Products for every warehouse x division cell -----------------------------
--
-- `division` here is the storage vocabulary: 'recycling' is the GreenWave
-- value (see src/divisions/divisions.constants.ts).

INSERT INTO materials (id, name, unit, category, division, warehouse_id, default_price, active)
VALUES
    ('d1000000-0001-4000-8000-000000000001', 'Calgary Baled Cardboard',    'kg',    'paper',      'recycling',  '22222222-2222-4222-8222-222222222222', 0.18, TRUE),
    ('d1000000-0002-4000-8000-000000000002', 'Calgary Nitrile Gloves',     'box',   'healthcare', 'healthcare', '22222222-2222-4222-8222-222222222222', 28.50, TRUE),
    ('d1000000-0003-4000-8000-000000000003', 'Ontario Mixed Plastics',     'kg',    'plastic',    'recycling',  '33333333-3333-4333-8333-333333333333', 0.22, TRUE),
    ('d1000000-0004-4000-8000-000000000004', 'Ontario Isolation Gowns',    'box',   'healthcare', 'healthcare', '33333333-3333-4333-8333-333333333333', 41.00, TRUE),
    ('d1000000-0005-4000-8000-000000000005', 'Maple Ridge Ferrous Scrap',  'kg',    'metal',      'recycling',  '11111111-1111-4111-8111-111111111111', 0.31, TRUE),
    ('d1000000-0006-4000-8000-000000000006', 'Maple Ridge Surgical Masks', 'box',   'healthcare', 'healthcare', '11111111-1111-4111-8111-111111111111', 19.75, TRUE)
ON CONFLICT (id) DO UPDATE SET
    name         = EXCLUDED.name,
    division     = EXCLUDED.division,
    warehouse_id = EXCLUDED.warehouse_id,
    active       = EXCLUDED.active;

-- Existing healthcare fixtures from seed 003 predate the division column and
-- were backfilled from `category` by migration 015; make that explicit here so
-- a fresh local database matches.
UPDATE materials SET division = 'healthcare'
 WHERE lower(category) = 'healthcare' AND division <> 'healthcare';

-- 4. Division-scoped customers ------------------------------------------------

INSERT INTO customers (id, name, bill_to, email, warehouse_id, division)
VALUES
    ('d2000000-0001-4000-8000-000000000001', 'Prairie Recycling Co-op',   '120 Foothills Way, Calgary, AB',  'ap@prairie-recycling.test',  '22222222-2222-4222-8222-222222222222', 'recycling'),
    ('d2000000-0002-4000-8000-000000000002', 'Bow Valley Medical Group',  '88 Clinic Rd, Calgary, AB',       'ap@bowvalleymed.test',       '22222222-2222-4222-8222-222222222222', 'healthcare'),
    ('d2000000-0003-4000-8000-000000000003', 'Great Lakes Materials Ltd', '400 Harbour St, Toronto, ON',     'ap@greatlakesmat.test',      '33333333-3333-4333-8333-333333333333', 'recycling'),
    ('d2000000-0004-4000-8000-000000000004', 'Fraser Health Supplies',    '9 Riverbend Ave, Maple Ridge, BC','ap@fraserhealthsup.test',    '11111111-1111-4111-8111-111111111111', 'healthcare')
ON CONFLICT (id) DO UPDATE SET
    name         = EXCLUDED.name,
    division     = EXCLUDED.division,
    warehouse_id = EXCLUDED.warehouse_id;

-- Pre-existing customers belong to the recycling business.
UPDATE customers SET division = 'recycling' WHERE division IS NULL;

-- 5. Inventory across every cell ----------------------------------------------

INSERT INTO inventory_transactions
    (id, warehouse_id, material_id, type, unit_type, division, xl, l, m, s, total, reference, created_by)
VALUES
    ('d3000000-0001-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'd1000000-0001-4000-8000-000000000001', 'inbound', 'pallet', 'recycling',  24, 0, 0, 0, 24, 'SEED-CGY-GW-1', 1),
    ('d3000000-0002-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'd1000000-0002-4000-8000-000000000002', 'inbound', 'box',    'healthcare', 0, 40, 30, 10, 80, 'SEED-CGY-HC-1', 1),
    ('d3000000-0003-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'd1000000-0003-4000-8000-000000000003', 'inbound', 'pallet', 'recycling',  18, 0, 0, 0, 18, 'SEED-ON-GW-1',  1),
    ('d3000000-0004-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'd1000000-0004-4000-8000-000000000004', 'inbound', 'box',    'healthcare', 0, 25, 15, 5,  45, 'SEED-ON-HC-1',  1),
    ('d3000000-0005-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'd1000000-0005-4000-8000-000000000005', 'inbound', 'pallet', 'recycling',  31, 0, 0, 0, 31, 'SEED-MR-GW-1',  1),
    ('d3000000-0006-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'd1000000-0006-4000-8000-000000000006', 'inbound', 'box',    'healthcare', 0, 60, 20, 12, 92, 'SEED-MR-HC-1',  1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO containers
    (id, warehouse_id, material_id, order_number, container_number, unit_type, division, xl, l, m, s, total, status, created_by)
VALUES
    ('d4000000-0001-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'd1000000-0001-4000-8000-000000000001', 'SEED-CGY-GW-1', 'GWCU1000001', 'pallet', 'recycling',  24, 0, 0, 0, 24, 'received', 1),
    ('d4000000-0002-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'd1000000-0002-4000-8000-000000000002', 'SEED-CGY-HC-1', 'HCCU2000001', 'box',    'healthcare', 0, 40, 30, 10, 80, 'received', 1),
    ('d4000000-0003-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'd1000000-0006-4000-8000-000000000006', 'SEED-MR-HC-1',  'HCCU2000002', 'box',    'healthcare', 0, 60, 20, 12, 92, 'received', 1)
ON CONFLICT (id) DO NOTHING;

-- Existing rows predating migration 013's division column belong to recycling.
UPDATE inventory_transactions SET division = 'recycling' WHERE division IS NULL;
UPDATE containers            SET division = 'recycling' WHERE division IS NULL;
UPDATE invoices              SET division = 'recycling' WHERE division IS NULL;
