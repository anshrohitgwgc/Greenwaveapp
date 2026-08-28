-- ==============================================================================
-- GreenWave Local Development Fixtures: V2 warehouses/materials/customer
-- MOCK DATA FOR LOCAL DEVELOPMENT ONLY - NOT FOR PRODUCTION
-- ==============================================================================

INSERT INTO warehouses (id, name, code, province, address, active)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'Maple Ridge', 'MR', 'BC', '123 Industrial Way, Maple Ridge, BC', TRUE),
    ('22222222-2222-4222-8222-222222222222', 'Calgary', 'CGY', 'AB', '456 Warehouse Rd, Calgary, AB', TRUE),
    ('33333333-3333-4333-8333-333333333333', 'Toronto', 'TOR', 'ON', '789 Depot Ave, Toronto, ON', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO materials (id, name, unit, category, default_price, active)
VALUES
    ('44444444-4444-4444-8444-444444444444', 'Mixed Electronics', 'kg', 'electronics', 0.35, TRUE),
    ('55555555-5555-4555-8555-555555555555', 'Non-Ferrous Scrap', 'kg', 'metal', 1.20, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO customers (id, name, bill_to, ship_to, email, warehouse_id)
VALUES
    (
        '66666666-6666-4666-8666-666666666666',
        'Acme Recycling Depot (Dev Mock)',
        '100 Bill St, Maple Ridge, BC',
        '100 Bill St, Maple Ridge, BC',
        'billing@acme-dev.local',
        '11111111-1111-4111-8111-111111111111'
    )
ON CONFLICT (id) DO NOTHING;
