-- ==============================================================================
-- GreenWave - Migration 021: Bank & credit-card accounts, statement import,
-- reconciliation, and accounts payable.
--
-- No live bank/card provider is integrated. Accounts are MANUAL_CSV; the
-- provider columns exist so a real feed adapter can be added without a schema
-- change. Imported transactions never post to the ledger until a person
-- categorizes or matches them.
--
-- Card data: only a 4-digit mask is stored (CHECK enforced). Full card
-- numbers, CVV, and track data have no column anywhere; the importer masks
-- card-number-like digit runs in free text before storage.
-- ==============================================================================

BEGIN;

INSERT INTO ledger_accounts (code, name, type, subtype, normal_balance, system_key) VALUES
    ('1150', 'Sales Tax Recoverable',           'ASSET',     'TAX_RECOVERABLE',  'DEBIT',  'SALES_TAX_RECOVERABLE')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS financial_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('BANK', 'CREDIT_CARD')),
    name VARCHAR(120) NOT NULL,
    institution VARCHAR(120),
    account_mask CHAR(4) CHECK (account_mask IS NULL OR account_mask ~ '^[0-9]{4}$'),
    account_type VARCHAR(24) NOT NULL
        CHECK (account_type IN ('CHEQUING', 'SAVINGS', 'CREDIT_CARD', 'LINE_OF_CREDIT')),
    currency VARCHAR(8) NOT NULL,
    ledger_account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    credit_limit_minor BIGINT CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
    statement_day SMALLINT CHECK (statement_day IS NULL OR statement_day BETWEEN 1 AND 31),
    payment_due_day SMALLINT CHECK (payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 31),
    connection_type VARCHAR(16) NOT NULL DEFAULT 'MANUAL_CSV'
        CHECK (connection_type IN ('MANUAL_CSV', 'PROVIDER')),
    connection_status VARCHAR(16) NOT NULL DEFAULT 'NOT_CONNECTED'
        CHECK (connection_status IN ('NOT_CONNECTED', 'CONNECTED', 'ERROR')),
    provider VARCHAR(48),
    provider_account_ref VARCHAR(128),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    last_imported_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- One statement account per GL account, so a reconciliation's book balance is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_ledger ON financial_accounts (ledger_account_id);

CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    filename VARCHAR(255) NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('PREVIEWED', 'COMMITTED', 'DISCARDED')),
    mapping JSONB NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    valid_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    errors JSONB,
    date_min DATE,
    date_max DATE,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    committed_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    committed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_import_batches_account ON import_batches (account_id, created_at);

CREATE TABLE IF NOT EXISTS import_batch_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_no INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('VALID', 'DUPLICATE', 'ERROR')),
    parsed JSONB,
    error TEXT,
    CONSTRAINT uq_import_batch_rows UNIQUE (batch_id, row_no)
);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    statement_end_date DATE NOT NULL,
    opening_balance_minor BIGINT NOT NULL,
    statement_ending_balance_minor BIGINT NOT NULL,
    cleared_balance_minor BIGINT,
    difference_minor BIGINT,
    status VARCHAR(16) NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    started_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    completed_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliations_one_open
    ON bank_reconciliations (account_id) WHERE status = 'IN_PROGRESS';

CREATE TABLE IF NOT EXISTS financial_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
    transaction_date DATE NOT NULL,
    posted_date DATE,
    description VARCHAR(255) NOT NULL,
    merchant VARCHAR(120),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    -- Statement perspective. BANK: CREDIT = money in. CREDIT_CARD: DEBIT = charge.
    direction VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    currency VARCHAR(8) NOT NULL,
    external_id VARCHAR(128),
    source VARCHAR(16) NOT NULL CHECK (source IN ('CSV_IMPORT', 'MANUAL', 'PROVIDER')),
    import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
    dedupe_hash CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'UNREVIEWED'
        CHECK (status IN ('UNREVIEWED', 'CATEGORIZED', 'MATCHED', 'RECONCILED', 'EXCLUDED')),
    category_account_id UUID REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    match_type VARCHAR(16) CHECK (match_type IS NULL OR match_type IN ('PAYOUT', 'BILL', 'TRANSFER', 'JOURNAL_ENTRY')),
    match_ref VARCHAR(128),
    matched_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    posted_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    reconciliation_id UUID REFERENCES bank_reconciliations(id) ON DELETE RESTRICT,
    receipt_ref VARCHAR(255),
    notes TEXT,
    reviewed_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_transactions_dedupe ON financial_transactions (account_id, dedupe_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_transactions_external
    ON financial_transactions (account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_transactions_account_date ON financial_transactions (account_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_status ON financial_transactions (status);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_match ON financial_transactions (match_type, match_ref);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_matched_entry ON financial_transactions (matched_journal_entry_id);

CREATE TABLE IF NOT EXISTS transaction_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES financial_transactions(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    description VARCHAR(255),
    CONSTRAINT uq_transaction_splits UNIQUE (transaction_id, line_no)
);

-- ------------------------------------------------------------------------------
-- Accounts payable. A purchase order is a commitment, not a liability: only an
-- approved bill credits Accounts Payable. bills.purchase_order_id is a link.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(64),
    default_expense_account_id UUID REFERENCES ledger_accounts(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors (name);

CREATE TABLE IF NOT EXISTS bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    bill_number VARCHAR(64) NOT NULL,
    bill_date DATE NOT NULL,
    due_date DATE,
    currency VARCHAR(8) NOT NULL,
    expense_account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
    subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
    tax_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    total_minor BIGINT NOT NULL CHECK (total_minor > 0),
    paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'VOID')),
    purchase_order_id UUID,
    memo TEXT,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    approved_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_bills_total CHECK (total_minor = subtotal_minor + tax_minor),
    CONSTRAINT chk_bills_paid CHECK (paid_minor <= total_minor),
    CONSTRAINT uq_bills_vendor_number UNIQUE (vendor_id, bill_number)
);
CREATE INDEX IF NOT EXISTS idx_bills_status_due ON bills (status, due_date);
CREATE INDEX IF NOT EXISTS idx_bills_purchase_order ON bills (purchase_order_id);

CREATE TABLE IF NOT EXISTS bill_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
    financial_transaction_id UUID NOT NULL REFERENCES financial_transactions(id) ON DELETE RESTRICT,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    paid_date DATE NOT NULL,
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_txn ON bill_payments (financial_transaction_id);

INSERT INTO permissions (key, description) VALUES
    ('banking:read', 'View bank and credit-card accounts and transactions'),
    ('banking:manage', 'Create accounts, import statements, categorize and match transactions'),
    ('reconciliation:complete', 'Complete statement reconciliations'),
    ('payables:read', 'View vendors, bills and AP aging'),
    ('payables:manage', 'Create, approve and void vendor bills')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.key IN ('banking:read', 'banking:manage', 'reconciliation:complete', 'payables:read', 'payables:manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager' AND p.key IN ('banking:read', 'payables:read')
ON CONFLICT DO NOTHING;

COMMIT;
