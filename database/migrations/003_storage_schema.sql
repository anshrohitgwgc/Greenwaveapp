-- ==============================================================================
-- GreenWave Core Application - Migration 003: Media & Photo Storage Schema
-- ==============================================================================

CREATE TABLE IF NOT EXISTS photo (
    id SERIAL PRIMARY KEY,
    "pickupId" INTEGER REFERENCES pickup(id) ON DELETE CASCADE,
    "objectKey" VARCHAR(500) NOT NULL,
    "bucketName" VARCHAR(255) NOT NULL DEFAULT 'greenwave-photos',
    "originalFilename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "uploadedBy" INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photo_pickup_id ON photo ("pickupId");
