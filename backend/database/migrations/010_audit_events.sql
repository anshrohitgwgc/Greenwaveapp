-- ==============================================================================
-- GreenWave V2 - Migration 010: Append-only audit log
--
-- Immutability is enforced at the application layer in this pass (no
-- PATCH/DELETE route exists for /audit anywhere in app/api). Real DB-level
-- immutability requires revoking UPDATE/DELETE from the application's
-- Postgres role, which requires a second, least-privileged role — see
-- docs/V2_ARCHITECTURE.md Known Limitations and V2_DEPLOYMENT_PLAN.md.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_user_id INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    actor_role VARCHAR(32),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100),
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity_type ON audit_events (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit_events (occurred_at);
