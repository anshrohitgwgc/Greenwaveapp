-- ==============================================================================
-- GreenWave Core Application - Migration 002: Pickups & Routing Schema
-- ==============================================================================

CREATE TYPE pickup_status AS ENUM ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS pickup (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status pickup_status NOT NULL DEFAULT 'pending',
    "wasteType" VARCHAR(100) NOT NULL DEFAULT 'electronics',
    "estimatedWeightKg" NUMERIC(10, 2),
    "actualWeightKg" NUMERIC(10, 2),
    "priceTotal" NUMERIC(10, 2),
    "assignedDriverId" INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    "scheduledDate" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "notes" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pickup_user_id ON pickup ("userId");
CREATE INDEX IF NOT EXISTS idx_pickup_status ON pickup (status);
CREATE INDEX IF NOT EXISTS idx_pickup_assigned_driver ON pickup ("assignedDriverId");
