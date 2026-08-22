-- ==============================================================================
-- Development Test Users Seed
-- Standard dev password for all accounts: "Password123!" (bcrypt hash $2b$12$...)
-- ==============================================================================

INSERT INTO "user" (id, "fullName", email, password, role, "createdAt", "updatedAt")
VALUES
    (1, 'Admin User', 'admin@greenwave.local', '$2b$12$e8rPcm2E7Lq84Vw1R7M5t.bXJ6.U8O1XU/uW2qT8g.W3k4J9X2m2C', 'admin', NOW(), NOW()),
    (2, 'Operations Manager', 'manager@greenwave.local', '$2b$12$e8rPcm2E7Lq84Vw1R7M5t.bXJ6.U8O1XU/uW2qT8g.W3k4J9X2m2C', 'manager', NOW(), NOW()),
    (3, 'Staff Operator', 'staff@greenwave.local', '$2b$12$e8rPcm2E7Lq84Vw1R7M5t.bXJ6.U8O1XU/uW2qT8g.W3k4J9X2m2C', 'staff', NOW(), NOW()),
    (4, 'Fleet Driver', 'driver@greenwave.local', '$2b$12$e8rPcm2E7Lq84Vw1R7M5t.bXJ6.U8O1XU/uW2qT8g.W3k4J9X2m2C', 'driver', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    email = EXCLUDED.email,
    role = EXCLUDED.role;

SELECT setval('user_id_seq', (SELECT MAX(id) FROM "user"));
