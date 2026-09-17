-- ==============================================================================
-- GreenWave - Migration 020: Double-entry accounting foundation + Stripe
-- financial mirror.
--
-- Money: BIGINT minor units. One currency per journal entry; reports are per
-- currency (no FX revaluation — see FINANCE_ARCHITECTURE.md).
--
-- Integrity is enforced in the database, not only in application code:
--   * every POSTED entry must balance (deferred constraint trigger)
--   * a line is either a debit or a credit, never both, never negative
--   * POSTED entries and their lines are immutable; corrections are reversals
--   * a (source_type, source_id, source_event) can post at most once
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- Chart of accounts
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    type VARCHAR(24) NOT NULL CHECK (type IN (
        'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_GOODS_SOLD',
        'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE')),
    subtype VARCHAR(40),
    normal_balance VARCHAR(6) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    parent_id UUID REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    system_key VARCHAR(48) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    tax_treatment JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_accounts_type ON ledger_accounts (type);
CREATE INDEX IF NOT EXISTS idx_ledger_accounts_parent ON ledger_accounts (parent_id);

-- ------------------------------------------------------------------------------
-- Journal
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL,
    description VARCHAR(255) NOT NULL,
    reference VARCHAR(100),
    status VARCHAR(12) NOT NULL DEFAULT 'POSTED'
        CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    currency VARCHAR(8) NOT NULL,
    source_type VARCHAR(48) NOT NULL,
    source_id VARCHAR(100),
    source_event VARCHAR(96),
    reversal_of UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    reversed_by UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    posted_at TIMESTAMP WITH TIME ZONE,
    request_id VARCHAR(64),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_source
    ON journal_entries (source_type, source_id, source_event)
    WHERE source_id IS NOT NULL AND source_event IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries (status);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries (source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    debit_minor BIGINT NOT NULL DEFAULT 0,
    credit_minor BIGINT NOT NULL DEFAULT 0,
    description VARCHAR(255),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    vendor_id UUID,
    CONSTRAINT chk_journal_lines_one_side CHECK (
        debit_minor >= 0 AND credit_minor >= 0
        AND ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))),
    CONSTRAINT uq_journal_lines_entry_line UNIQUE (entry_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_customer ON journal_lines (customer_id);

-- Balance check, deferred to commit so an entry and its lines can be inserted
-- in one transaction.
CREATE OR REPLACE FUNCTION gw_assert_entry_balanced() RETURNS trigger AS $$
DECLARE
    v_entry UUID;
    v_status TEXT;
    v_debits BIGINT;
    v_credits BIGINT;
    v_lines INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'journal_lines' THEN
        v_entry := NEW.entry_id;
    ELSE
        v_entry := NEW.id;
    END IF;
    SELECT status INTO v_status FROM journal_entries WHERE id = v_entry;
    IF v_status IS NULL OR v_status = 'DRAFT' THEN
        RETURN NULL;
    END IF;
    SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0), COUNT(*)
      INTO v_debits, v_credits, v_lines
      FROM journal_lines WHERE entry_id = v_entry;
    IF v_lines < 2 OR v_debits <> v_credits OR v_debits = 0 THEN
        RAISE EXCEPTION 'journal entry % is not balanced (debits %, credits %, lines %)',
            v_entry, v_debits, v_credits, v_lines USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
    AFTER INSERT ON journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION gw_assert_entry_balanced();

DROP TRIGGER IF EXISTS trg_journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_entries_balanced
    AFTER INSERT OR UPDATE OF status ON journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION gw_assert_entry_balanced();

-- Immutability of posted history.
CREATE OR REPLACE FUNCTION gw_guard_journal_entry_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'posted journal entry % cannot be deleted; reverse it', OLD.id
                USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'DRAFT' THEN
        RETURN NEW;
    END IF;
    -- A POSTED entry may only be marked REVERSED (with its reversal id).
    IF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' AND OLD.reversed_by IS NULL
       AND NEW.reversed_by IS NOT NULL
       AND NEW.entry_date = OLD.entry_date AND NEW.currency = OLD.currency
       AND NEW.description = OLD.description
       AND NEW.source_type = OLD.source_type
       AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
       AND NEW.source_event IS NOT DISTINCT FROM OLD.source_event THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'journal entry % is % and immutable', OLD.id, OLD.status
        USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_immutable ON journal_entries;
CREATE TRIGGER trg_journal_entries_immutable
    BEFORE UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION gw_guard_journal_entry_change();

CREATE OR REPLACE FUNCTION gw_guard_journal_line_change() RETURNS trigger AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM journal_entries WHERE id = OLD.entry_id;
    IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'lines of % journal entry % are immutable', v_status, OLD.entry_id
            USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_immutable ON journal_lines;
CREATE TRIGGER trg_journal_lines_immutable
    BEFORE UPDATE OR DELETE ON journal_lines
    FOR EACH ROW EXECUTE FUNCTION gw_guard_journal_line_change();

-- ------------------------------------------------------------------------------
-- Default chart of accounts (mirrors src/accounting/chart-of-accounts.ts)
-- ------------------------------------------------------------------------------
INSERT INTO ledger_accounts (code, name, type, subtype, normal_balance, system_key) VALUES
    ('1000', 'Cash on Hand',                    'ASSET',     'CASH',             'DEBIT',  'CASH_ON_HAND'),
    ('1010', 'Operating Bank Account',          'ASSET',     'BANK',             'DEBIT',  'BANK_OPERATING'),
    ('1050', 'Stripe Clearing',                 'ASSET',     'CLEARING',         'DEBIT',  'STRIPE_CLEARING'),
    ('1060', 'Stripe Disputed Funds',           'ASSET',     'OTHER_CURRENT',    'DEBIT',  'STRIPE_DISPUTES'),
    ('1100', 'Accounts Receivable',             'ASSET',     'ACCOUNTS_RECEIVABLE', 'DEBIT', 'AR'),
    ('1200', 'Inventory',                       'ASSET',     'INVENTORY',        'DEBIT',  'INVENTORY'),
    ('1500', 'Equipment',                       'ASSET',     'FIXED_ASSET',      'DEBIT',  'EQUIPMENT'),
    ('1590', 'Accumulated Depreciation',        'ASSET',     'CONTRA_ASSET',     'CREDIT', NULL),
    ('1900', 'Other Assets',                    'ASSET',     'OTHER_ASSET',      'DEBIT',  NULL),
    ('1999', 'Suspense',                        'ASSET',     'SUSPENSE',         'DEBIT',  'SUSPENSE'),
    ('2000', 'Accounts Payable',                'LIABILITY', 'ACCOUNTS_PAYABLE', 'CREDIT', 'AP'),
    ('2100', 'Corporate Credit Card',           'LIABILITY', 'CREDIT_CARD',      'CREDIT', 'CREDIT_CARD'),
    ('2200', 'Sales Tax Payable',               'LIABILITY', 'TAX_PAYABLE',      'CREDIT', 'SALES_TAX_PAYABLE'),
    ('2300', 'Payroll Liabilities',             'LIABILITY', 'PAYROLL',          'CREDIT', NULL),
    ('2500', 'Loans Payable',                   'LIABILITY', 'LOAN',             'CREDIT', NULL),
    ('2900', 'Other Liabilities',               'LIABILITY', 'OTHER_LIABILITY',  'CREDIT', NULL),
    ('3000', 'Owner / Shareholder Equity',      'EQUITY',    'OWNER_EQUITY',     'CREDIT', 'OWNER_EQUITY'),
    ('3900', 'Retained Earnings',               'EQUITY',    'RETAINED_EARNINGS', 'CREDIT', 'RETAINED_EARNINGS'),
    ('3950', 'Opening Balance Equity',          'EQUITY',    'OPENING_BALANCE',  'CREDIT', 'OPENING_BALANCE_EQUITY'),
    ('4000', 'Sales Revenue',                   'REVENUE',   'SALES',            'CREDIT', 'REVENUE_SALES'),
    ('4900', 'Sales Refunds & Allowances',      'REVENUE',   'CONTRA_REVENUE',   'DEBIT',  'SALES_REFUNDS'),
    ('5000', 'Cost of Goods Sold',              'COST_OF_GOODS_SOLD', 'COGS',    'DEBIT',  'COGS'),
    ('6000', 'Merchant Processing Fees',        'EXPENSE',   'BANK_FEES',        'DEBIT',  'MERCHANT_FEES'),
    ('6010', 'Chargeback & Dispute Losses',     'EXPENSE',   'DISPUTE_LOSS',     'DEBIT',  'DISPUTE_LOSSES'),
    ('6100', 'Uncategorized Expense',           'EXPENSE',   'UNCATEGORIZED',    'DEBIT',  'UNCATEGORIZED_EXPENSE'),
    ('6200', 'Rent',                            'EXPENSE',   'OCCUPANCY',        'DEBIT',  NULL),
    ('6300', 'Utilities',                       'EXPENSE',   'OCCUPANCY',        'DEBIT',  NULL),
    ('6400', 'Vehicle & Fuel',                  'EXPENSE',   'VEHICLE',          'DEBIT',  NULL),
    ('6500', 'Wages & Salaries',                'EXPENSE',   'PAYROLL',          'DEBIT',  NULL),
    ('6600', 'Office & Administrative',         'EXPENSE',   'ADMIN',            'DEBIT',  NULL),
    ('6700', 'Bank Charges',                    'EXPENSE',   'BANK_FEES',        'DEBIT',  'BANK_CHARGES'),
    ('7000', 'Other Income',                    'OTHER_INCOME', 'OTHER_INCOME',  'CREDIT', 'OTHER_INCOME'),
    ('8000', 'Other Expense',                   'OTHER_EXPENSE', 'OTHER_EXPENSE', 'DEBIT', 'OTHER_EXPENSE')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- Stripe financial mirror (populated by webhooks + sync; source of truth for
-- *what Stripe reports*, not for GreenWave business state)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe_balance_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_txn_id VARCHAR(128) NOT NULL UNIQUE,
    type VARCHAR(48) NOT NULL,
    reporting_category VARCHAR(64),
    amount_minor BIGINT NOT NULL,
    fee_minor BIGINT NOT NULL DEFAULT 0,
    net_minor BIGINT NOT NULL,
    currency VARCHAR(8) NOT NULL,
    status VARCHAR(16) NOT NULL,
    source_id VARCHAR(128),
    payout_id VARCHAR(128),
    description VARCHAR(255),
    provider_created TIMESTAMP WITH TIME ZONE NOT NULL,
    available_on TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_bt_created ON stripe_balance_transactions (provider_created);
CREATE INDEX IF NOT EXISTS idx_stripe_bt_source ON stripe_balance_transactions (source_id);
CREATE INDEX IF NOT EXISTS idx_stripe_bt_payout ON stripe_balance_transactions (payout_id);
CREATE INDEX IF NOT EXISTS idx_stripe_bt_type ON stripe_balance_transactions (type);

CREATE TABLE IF NOT EXISTS stripe_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_payout_id VARCHAR(128) NOT NULL UNIQUE,
    amount_minor BIGINT NOT NULL,
    currency VARCHAR(8) NOT NULL,
    status VARCHAR(24) NOT NULL,
    method VARCHAR(24),
    arrival_date TIMESTAMP WITH TIME ZONE,
    provider_created TIMESTAMP WITH TIME ZONE NOT NULL,
    destination_display VARCHAR(64),
    failure_code VARCHAR(64),
    last_event_created BIGINT,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_arrival ON stripe_payouts (arrival_date);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_status ON stripe_payouts (status);

CREATE TABLE IF NOT EXISTS stripe_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_dispute_id VARCHAR(128) NOT NULL UNIQUE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    provider_charge_id VARCHAR(128),
    amount_minor BIGINT NOT NULL,
    currency VARCHAR(8) NOT NULL,
    status VARCHAR(40) NOT NULL,
    reason VARCHAR(64),
    evidence_due_by TIMESTAMP WITH TIME ZONE,
    provider_created TIMESTAMP WITH TIME ZONE NOT NULL,
    last_event_created BIGINT,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stripe_disputes_payment ON stripe_disputes (payment_id);

CREATE TABLE IF NOT EXISTS stripe_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('INITIAL', 'INCREMENTAL', 'MANUAL')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    from_created BIGINT,
    to_created BIGINT,
    counts JSONB,
    error TEXT,
    triggered_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_stripe_sync_runs_started ON stripe_sync_runs (started_at);
-- Only one sync may run at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_sync_one_running
    ON stripe_sync_runs ((true)) WHERE status = 'RUNNING';

-- ------------------------------------------------------------------------------
-- Permissions
-- ------------------------------------------------------------------------------
INSERT INTO permissions (key, description) VALUES
    ('accounting:read', 'View ledger, chart of accounts, and financial reports'),
    ('accounting:post', 'Create, post, and reverse manual journal entries'),
    ('accounting:manage_accounts', 'Create and edit chart-of-accounts entries')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.key IN ('accounting:read', 'accounting:post', 'accounting:manage_accounts')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager' AND p.key = 'accounting:read'
ON CONFLICT DO NOTHING;

COMMIT;
