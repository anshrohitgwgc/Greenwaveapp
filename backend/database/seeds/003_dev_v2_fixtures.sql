-- ==============================================================================
-- GreenWave Local Development Fixtures: V2 warehouses/materials/customer
-- MOCK DATA FOR LOCAL DEVELOPMENT ONLY - NOT FOR PRODUCTION
-- ==============================================================================

INSERT INTO warehouses (id, name, code, province, address, active)
VALUES
    ('22222222-2222-4222-8222-222222222222', 'Calgary, AB', 'CGY', 'AB', '456 Warehouse Rd, Calgary, AB', TRUE),
    ('33333333-3333-4333-8333-333333333333', 'Ontario', 'ON', 'ON', '789 Depot Ave, Toronto, ON', TRUE),
    ('11111111-1111-4111-8111-111111111111', 'Maple Ridge, BC', 'MR', 'BC', '123 Industrial Way, Maple Ridge, BC', TRUE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    code = EXCLUDED.code,
    province = EXCLUDED.province,
    active = EXCLUDED.active;

INSERT INTO materials (id, name, unit, category, default_price, active)
VALUES
    ('44444444-4444-4444-8444-444444444444', 'Mixed Electronics', 'kg', 'electronics', 0.35, TRUE),
    ('55555555-5555-4555-8555-555555555555', 'Non-Ferrous Scrap', 'kg', 'metal', 1.20, TRUE),
    ('77777777-7777-4777-8777-777777777777', 'Synguard 100', 'cases', 'healthcare', 45.00, TRUE),
    ('88888888-8888-4888-8888-888888888888', 'Sonic 300', 'cases', 'healthcare', 65.00, TRUE),
    ('99999999-9999-4999-8999-999999999999', 'Transform 200', 'cases', 'healthcare', 55.00, TRUE),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Transform 100', 'cases', 'healthcare', 48.00, TRUE),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Robust 100', 'cases', 'healthcare', 42.00, TRUE)
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
