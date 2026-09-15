-- Sample Pickups Data
INSERT INTO pickup (id, "userId", address, status, "wasteType", "estimatedWeightKg", "assignedDriverId", "scheduledDate", "createdAt")
VALUES
    (1, 3, '123 Ocean View Ave, Vancouver, BC', 'pending', 'electronics', 45.0, NULL, NOW() + INTERVAL '1 day', NOW()),
    (2, 3, '456 Granville Street, Vancouver, BC', 'scheduled', 'commercial-plastics', 120.0, 4, NOW() + INTERVAL '2 hours', NOW()),
    (3, 3, '789 Industrial Way, Burnaby, BC', 'completed', 'metals', 350.0, 4, NOW() - INTERVAL '1 day', NOW())
ON CONFLICT (id) DO NOTHING;

SELECT setval('pickup_id_seq', (SELECT MAX(id) FROM pickup));
