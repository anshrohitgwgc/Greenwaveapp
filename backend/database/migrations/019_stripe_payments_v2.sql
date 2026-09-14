-- ==============================================================================
-- GreenWave - Migration 019: Real Stripe payments (PaymentIntents), provider
-- event idempotency, refunds, and hashed payment links.
--
-- Forward-only. Nothing is dropped and no rows are deleted.
--
-- Background: migrations 014 created `payments` for a *simulated* gateway
-- (self-generated cs_test_ ids, no Stripe API calls). This migration moves the
-- table to integer minor units and explicit status semantics, and adds the
-- tables the real integration needs. Legacy rows are preserved and flagged.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. payments: minor units, provider detail, explicit states
-- ------------------------------------------------------------------------------
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS amount_minor BIGINT,
    ADD COLUMN IF NOT EXISTS fee_minor BIGINT,
    ADD COLUMN IF NOT EXISTS net_minor BIGINT,
    ADD COLUMN IF NOT EXISTS refunded_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS disputed_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_method_type VARCHAR(48),
    ADD COLUMN IF NOT EXISTS payment_method_display VARCHAR(64),
    ADD COLUMN IF NOT EXISTS provider_customer_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS provider_charge_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS provider_balance_txn_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS dispute_status VARCHAR(48),
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128),
    ADD COLUMN IF NOT EXISTS last_event_created BIGINT,
    ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP WITH TIME ZONE;

UPDATE payments
   SET amount_minor = ROUND(amount * 100)::BIGINT
 WHERE amount_minor IS NULL;

ALTER TABLE payments ALTER COLUMN amount_minor SET NOT NULL;

-- Legacy status vocabulary -> explicit states. Legacy 'pending' rows were
-- simulated checkout sessions that never existed at Stripe, so they cannot
-- complete: they become CANCELED. Every migrated row is flagged in metadata.
UPDATE payments
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('legacySimulatedGateway', true,
                                        'legacyStatus', status),
       status = CASE status
                  WHEN 'pending'   THEN 'CANCELED'
                  WHEN 'paid'      THEN 'SUCCEEDED'
                  WHEN 'failed'    THEN 'FAILED'
                  WHEN 'cancelled' THEN 'CANCELED'
                  WHEN 'refunded'  THEN 'REFUNDED'
                  ELSE status
                END,
       canceled_at = CASE WHEN status IN ('pending', 'cancelled')
                          THEN CURRENT_TIMESTAMP ELSE canceled_at END
 WHERE status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded');

ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'CREATED';

ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS chk_payments_status,
    ADD CONSTRAINT chk_payments_status CHECK (status IN (
        'CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED',
        'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED'));

ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS chk_payments_amounts,
    ADD CONSTRAINT chk_payments_amounts CHECK (
        amount_minor > 0
        AND refunded_minor >= 0
        AND refunded_minor <= amount_minor
        AND disputed_minor >= 0);

-- Idempotency / double-payment guards enforced by the database, not just code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_key
    ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_payment
    ON payments (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;

-- At most one open attempt per invoice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_open_attempt
    ON payments (invoice_id)
    WHERE status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING');

-- Deliberately NO unique index on settled payments per invoice: a second
-- capture (e.g. a stale checkout page) is real money and must be recorded
-- truthfully and flagged for refund, not rejected by a constraint. Double
-- payment is prevented upstream: one open attempt per invoice (above), an
-- invoice row lock, and cancellation of prior PaymentIntents.

CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_charge ON payments (provider_charge_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at);

-- ------------------------------------------------------------------------------
-- 2. provider_events: webhook idempotency ledger
--    Only a bounded summary is stored, never the raw payload (which can hold
--    customer PII and billing details).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(32) NOT NULL DEFAULT 'stripe',
    provider_event_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(96) NOT NULL,
    object_id VARCHAR(128),
    livemode BOOLEAN NOT NULL DEFAULT false,
    provider_created BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    summary JSONB,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_provider_events UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_events_object ON provider_events (object_id);
CREATE INDEX IF NOT EXISTS idx_provider_events_status ON provider_events (status);
CREATE INDEX IF NOT EXISTS idx_provider_events_type ON provider_events (event_type);

-- ------------------------------------------------------------------------------
-- 3. payment_refunds
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    provider VARCHAR(32) NOT NULL DEFAULT 'stripe',
    provider_refund_id VARCHAR(128),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(8) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REQUIRES_ACTION')),
    reason VARCHAR(48),
    note TEXT,
    failure_reason TEXT,
    idempotency_key VARCHAR(128) NOT NULL,
    requested_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    succeeded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_refunds_idempotency UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_provider
    ON payment_refunds (provider, provider_refund_id)
    WHERE provider_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON payment_refunds (payment_id);

-- ------------------------------------------------------------------------------
-- 4. Hashed payment links
--    token = HMAC-SHA256(PAYMENT_LINK_SECRET, nonce). The database holds the
--    nonce and SHA-256(token) only, so a database read alone cannot produce a
--    working link, while an authorized manager can still re-display it. Existing plaintext tokens are hashed so links
--    already emailed keep working. The legacy plaintext column is retained
--    (not written by new code) to keep an application rollback possible; it is
--    cleared in a later migration once 019 is confirmed in production.
-- ------------------------------------------------------------------------------
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS payment_token_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS payment_link_nonce CHAR(64),
    ADD COLUMN IF NOT EXISTS payment_link_created_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS payment_link_revoked_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);

UPDATE invoices
   SET payment_token_hash = encode(sha256(convert_to(payment_token, 'UTF8')), 'hex'),
       payment_link_created_at = COALESCE(payment_link_created_at, updated_at)
 WHERE payment_token IS NOT NULL AND payment_token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_payment_token_hash
    ON invoices (payment_token_hash) WHERE payment_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices (due_date);

-- ------------------------------------------------------------------------------
-- 5. Outbound email log (dedupe: one confirmation per payment, etc.)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dedupe_key VARCHAR(160) NOT NULL,
    template VARCHAR(64) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
    entity_type VARCHAR(64),
    entity_id VARCHAR(100),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    provider_message_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_email_outbox_dedupe UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_entity ON email_outbox (entity_type, entity_id);

-- ------------------------------------------------------------------------------
-- 6. Permissions
-- ------------------------------------------------------------------------------
INSERT INTO permissions (key, description) VALUES
    ('payments:sync', 'Run Stripe financial data synchronization')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.key = 'payments:sync'
ON CONFLICT DO NOTHING;

COMMIT;
