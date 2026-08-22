-- ==============================================================================
-- GreenWave Local Development Fixtures: Mock Users Seed
-- MOCK DATA FOR LOCAL DEVELOPMENT ONLY - NOT FOR PRODUCTION
-- Standard local test password for all dev accounts: "DevPassword123!"
-- ==============================================================================

INSERT INTO "user" (id, "fullName", email, password, role, "createdAt", "updatedAt")
VALUES
    (1, 'Admin User (Dev Mock)', 'admin@greenwave.local', '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'admin', NOW(), NOW()),
    (2, 'Operations Manager (Dev Mock)', 'manager@greenwave.local', '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'manager', NOW(), NOW()),
    (3, 'Staff Operator (Dev Mock)', 'staff@greenwave.local', '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'staff', NOW(), NOW()),
    (4, 'Fleet Driver (Dev Mock)', 'driver@greenwave.local', '$2b$12$Zq4aVES8RgcIRMlYy4gjceRqRR3hQ6EanUnRgbsGryi2Kadj/I7EG', 'driver', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
    "fullName" = EXCLUDED."fullName",
    email = EXCLUDED.email,
    password = EXCLUDED.password,
    role = EXCLUDED.role;

SELECT setval('user_id_seq', (SELECT MAX(id) FROM "user"));
