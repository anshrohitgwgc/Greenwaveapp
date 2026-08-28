-- ==============================================================================
-- GreenWave V2 - Migration 009: Admin photo library + staff time clock
--
-- `photos` (this migration) is intentionally separate from the pre-existing
-- `photo` table (migration 003, still tied to `pickup`) — kept for backward
-- compatibility with the pickups flow rather than repurposed.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_key VARCHAR(500) NOT NULL,
    bucket_name VARCHAR(255) NOT NULL DEFAULT 'greenwave-photos',
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    job_reference VARCHAR(100),
    photo_type VARCHAR(50),
    taken_by INTEGER NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
    taken_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photos_warehouse ON photos (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_photos_taken_by ON photos (taken_by);
CREATE INDEX IF NOT EXISTS idx_photos_photo_type ON photos (photo_type);

CREATE TABLE IF NOT EXISTS timesheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
    clock_out TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_timesheets_user ON timesheets (user_id);

-- The actual duplicate-active-shift guard: a user can have at most one row
-- with clock_out IS NULL at a time. The application also checks this
-- before insert, but the partial unique index is what makes it race-safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_shift_per_user
    ON timesheets (user_id) WHERE clock_out IS NULL;
