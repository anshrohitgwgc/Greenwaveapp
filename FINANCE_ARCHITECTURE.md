# GreenWave Recycling Inc. — Double-Entry Finance & Banking Architecture

## 1. Accounting Principles & Architectural Foundation

GreenWave's financial subsystem is designed from first principles as a **strict double-entry general ledger**. Every financial transaction consists of at least two journal lines where the sum of debits must identically equal the sum of credits.

### 1.1 Integer Minor Unit Arithmetic
- All financial calculations, balances, invoices, bill line items, and bank statements operate strictly in **integer minor units** (cents for CAD and USD, stored as SQL `BIGINT`).
- **Floating-point types (`FLOAT`, `DOUBLE`, `REAL`) are strictly prohibited** in schemas and calculations to eliminate rounding drift and precision loss.
- Currency formatting is isolated to the presentation layer (`formatMinor(125050)` -> `$1,250.50`).

### 1.2 Deferred Database Integrity Enforcement
In PostgreSQL, ledger balance is enforced by a deferred constraint trigger defined in migration `020_accounting_ledger.sql`:
```sql
CREATE CONSTRAINT TRIGGER trg_check_journal_balance
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_journal_entry_balance();
```
- **How it works:** Within a database transaction, individual journal lines can be inserted sequentially. At transaction commit time, PostgreSQL invokes `check_journal_entry_balance()` across all affected `journal_entry_id` records. If `SUM(debit_amount_minor) != SUM(credit_amount_minor)`, the entire transaction is automatically rolled back.

---

## 2. Standard Chart of Accounts

GreenWave uses an industry-standard 4-digit Chart of Accounts categorized across 5 fundamental financial classes:

| Class | Normal Balance | Code Range | Description |
|---|---|---|---|
| **ASSET** | DEBIT | 1000 - 1999 | Resources owned (Cash, Accounts Receivable, Inventory, Equipment) |
| **LIABILITY** | CREDIT | 2000 - 2999 | Obligations owed (Accounts Payable, Credit Cards, Sales Tax Payable) |
| **EQUITY** | CREDIT | 3000 - 3999 | Owner's stake and Retained Earnings |
| **REVENUE** | CREDIT | 4000 - 4999 | Inflow from operations (Recycling Services, Material Sales) |
| **EXPENSE** | DEBIT | 5000 - 6999 | Costs incurred (COGS, Stripe Fees, Bank Fees, Payroll, Office) |

### 2.1 Default System Chart of Accounts

| Code | Account Key | Class | Currency | Normal | Purpose |
|---|---|---|---|---|---|
| `1010` | `OPERATING_CHECKING_CAD` | `ASSET` | `CAD` | `DEBIT` | Primary CAD operating bank account |
| `1020` | `OPERATING_CHECKING_USD` | `ASSET` | `USD` | `DEBIT` | USD cross-border transactions |
| `1050` | `STRIPE_CLEARING_CAD` | `ASSET` | `CAD` | `DEBIT` | Pending card settlements from Stripe |
| `1100` | `AR_CAD` | `ASSET` | `CAD` | `DEBIT` | Uncollected customer invoices (CAD) |
| `1110` | `AR_USD` | `ASSET` | `USD` | `DEBIT` | Uncollected customer invoices (USD) |
| `2010` | `AP_CAD` | `LIABILITY` | `CAD` | `CREDIT` | Outstanding vendor bills (CAD) |
| `2020` | `AP_USD` | `LIABILITY` | `USD` | `CREDIT` | Outstanding vendor bills (USD) |
| `2100` | `CORP_VISA_CAD` | `LIABILITY` | `CAD` | `CREDIT` | Corporate credit card payable |
| `2200` | `SALES_TAX_PAYABLE` | `LIABILITY` | `CAD` | `CREDIT` | Collected GST/HST owed to CRA |
| `3000` | `RETAINED_EARNINGS` | `EQUITY` | `CAD` | `CREDIT` | Cumulative net profits/losses |
| `4010` | `REVENUE_RECYCLING` | `REVENUE` | `CAD` | `CREDIT` | Pickup and e-waste recycling fees |
| `4020` | `REVENUE_MATERIALS` | `REVENUE` | `CAD` | `CREDIT` | Recovered metal/plastics sales |
| `5010` | `COGS_PROCESSING` | `EXPENSE` | `CAD` | `DEBIT` | Direct shredding and sorting costs |
| `6010` | `EXPENSE_STRIPE_FEES` | `EXPENSE` | `CAD` | `DEBIT` | Stripe processing fee deductions |
| `6100` | `EXPENSE_BANK_FEES` | `EXPENSE` | `CAD` | `DEBIT` | Wire fees, monthly service charges |
| `6200` | `EXPENSE_OFFICE` | `EXPENSE` | `CAD` | `DEBIT` | General administrative supplies |

---

## 3. Automated General Ledger Posting Workflows

Every operational activity in the platform generates balanced journal entries automatically via `LedgerService`:

```
1. Customer Invoice Issued ($1,000.00 + $130.00 HST):
   DR  1100 (Accounts Receivable CAD)             $1,130.00
       CR  4010 (Recycling Services Revenue)                   $1,000.00
       CR  2200 (Sales Tax Payable - HST)                         $130.00

2. Customer Pays via Stripe ($1,130.00 with $33.07 Stripe processing fee):
   DR  1050 (Stripe Clearing CAD)                 $1,096.93
   DR  6010 (Stripe Fee Expense)                     $33.07
       CR  1100 (Accounts Receivable CAD)                     $1,130.00

3. Stripe Settles Payout to Bank Account ($1,096.93):
   DR  1010 (Operating Checking CAD)              $1,096.93
       CR  1050 (Stripe Clearing CAD)                         $1,096.93

4. Vendor Bill Received (Facility Electrician $450.00):
   DR  6200 (Office & Facility Maintenance)         $450.00
       CR  2010 (Accounts Payable CAD)                          $450.00

5. Bill Paid via Wire/Check:
   DR  2010 (Accounts Payable CAD)                  $450.00
       CR  1010 (Operating Checking CAD)                        $450.00
```

---

## 4. Banking & Statement Import Pipeline

The banking subsystem allows managing physical bank accounts and corporate credit cards with automated CSV statement import, deduplication, and reconciliation.

```
+---------------------------------------------------------------------------------------------------+
|                                  STATEMENT IMPORT PIPELINE                                        |
+---------------------------------------------------------------------------------------------------+
  [ Bank CSV File ]
      |
      | 1. Upload via POST /api/banking/accounts/:id/import-csv
      v
  [ parseCsvRows & parseDateWithFormat ]
      |
      | 2. Parses comma/quote delimiters, CRLF lines, and date formats
      v
  [ PAN Masking Filter: maskSensitiveData() ]
      |
      | 3. Regex matches 13-19 digit card numbers -> Replaces with [CARD ...XXXX]
      v
  [ SHA-256 Row Fingerprinting ]
      |
      | 4. Hash = sha256(accountId + date + amountMinor + direction + externalId/desc)
      v
  [ Deduplication Engine ]
      |
      | 5. If hash exists in import_batch_rows -> Flag as DUPLICATE, skip import
      v
  [ Financial Transaction Creation ]
      |
      | 6. Creates financial_transactions with status = UNREVIEWED
      v
  [ PostgreSQL Production DB ]
```

### 4.1 Cardholder Data Protection (PAN Masking)
To prevent accidental storage of Payment Card Industry (PCI) card data from bank or credit card statements, all text fields (description, merchant, memo) pass through `maskSensitiveData`:
- Regex: `/\b(?:\d[ -]*?){13,19}\b/g`
- Example: `"PURCHASE 4532 1234 5678 9012 TORONTO"` -> `"PURCHASE [CARD ...9012] TORONTO"`
- Sanitization executes **both** on client upload preview and backend ingestion before database insertion.

### 4.2 Deduplication Hashing
Each imported row receives a deterministic SHA-256 fingerprint:
```typescript
const dedupeHash = createHash('sha256')
  .update(`${accountId}:${transactionDate}:${amountMinor}:${direction}:${externalId ?? description}`)
  .digest('hex');
```
If an accountant imports overlapping monthly statements, duplicate transactions are caught automatically and skipped without user intervention.

---

## 5. Bank Reconciliation Engine

Bank reconciliation verifies that the organization's general ledger reflects the true balance reported by the financial institution.

### 5.1 Worksheet Balance Equation
A reconciliation period cannot be closed unless the discrepancy is exactly zero:
$$\text{Discrepancy} = \text{Closing Balance} - \left(\text{Opening Balance} + \sum \text{Cleared Credits} - \sum \text{Cleared Debits}\right) = 0$$

### 5.2 Transaction State Lifecycle
- `UNREVIEWED`: Newly imported statement line requiring review.
- `CATEGORIZED`: User assigned an expense/revenue account; a balancing journal entry was posted to the GL.
- `MATCHED`: Statement row matched against an existing book transaction (Stripe payout, customer payment receipt, or bill payment).
- `RECONCILED`: Verified and locked into a completed reconciliation statement.
- `EXCLUDED`: Ignored line (e.g. statement header artifact, reversal, or pre-cutoff entry) with mandatory reason audit trail.

---

## 6. Financial Reports & Statements

Financial reports are computed directly from ledger journal lines and invoice records:

### 6.1 Profit & Loss (Income Statement) — `GET /api/accounting/reports/profit-and-loss`
- **Formula:**
  $$\text{Net Income} = \text{Operating Revenue} - \text{Cost of Goods Sold} - \text{Operating Expenses}$$
- Filterable by date range (`from`, `to`), currency (`CAD` or `USD`), and division/warehouse.

### 6.2 Balance Sheet — `GET /api/accounting/reports/balance-sheet`
- **Formula:**
  $$\text{Total Assets} = \text{Total Liabilities} + \text{Total Equity} + \text{Year-to-Date Net Income}$$
- System verifies this equation on every report generation and flags any balance sheet discrepancy.

### 6.3 Accounts Receivable (AR) Aging — `GET /api/accounting/reports/ar-aging`
- Categorizes all outstanding unpaid invoices into standard risk buckets:
  - **Current:** 0–30 days from invoice date
  - **31–60 Days:** Early follow-up
  - **61–90 Days:** Overdue / manager review
  - **91+ Days:** High risk / collections
- Aggregated by customer with individual invoice drill-down.

---

## 7. Security, Auditing & Access Control

1. **Role-Based Access Control (RBAC):**
   - General Ledger, Chart of Accounts, Reconciliation, and Balance Sheet: Restricted to `admin` or users with `accounting:view` / `accounting:manage`.
   - Division managers have read-only access to their division's revenue and operating expense reports.
2. **Audit Trails (`audit_logs` table):**
   - Every journal entry, bank reconciliation completion, transaction categorization, and manual adjustment logs actor user ID, timestamp, before/after values, and client IP.
