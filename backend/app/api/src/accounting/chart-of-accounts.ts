/**
 * Chart-of-accounts vocabulary and the default chart.
 *
 * DEFAULT_CHART mirrors the INSERTs in migrations 020/021 (a unit test checks they
 * agree). Posting rules refer to accounts only through SystemAccountKey, never
 * by code or name, so an administrator can renumber or rename accounts
 * without breaking automatic postings.
 */

export const ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'COST_OF_GOODS_SOLD',
  'EXPENSE',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type NormalBalance = 'DEBIT' | 'CREDIT';

export const DEFAULT_NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  ASSET: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
  COST_OF_GOODS_SOLD: 'DEBIT',
  EXPENSE: 'DEBIT',
  OTHER_INCOME: 'CREDIT',
  OTHER_EXPENSE: 'DEBIT',
};

export const PROFIT_AND_LOSS_TYPES: readonly AccountType[] = [
  'REVENUE',
  'COST_OF_GOODS_SOLD',
  'EXPENSE',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
];

export const BALANCE_SHEET_TYPES: readonly AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY'];

export const SYSTEM_ACCOUNT_KEYS = [
  'CASH_ON_HAND',
  'BANK_OPERATING',
  'STRIPE_CLEARING',
  'STRIPE_DISPUTES',
  'AR',
  'SALES_TAX_RECOVERABLE',
  'INVENTORY',
  'EQUIPMENT',
  'SUSPENSE',
  'AP',
  'CREDIT_CARD',
  'SALES_TAX_PAYABLE',
  'OWNER_EQUITY',
  'RETAINED_EARNINGS',
  'OPENING_BALANCE_EQUITY',
  'REVENUE_SALES',
  'SALES_REFUNDS',
  'COGS',
  'MERCHANT_FEES',
  'DISPUTE_LOSSES',
  'UNCATEGORIZED_EXPENSE',
  'BANK_CHARGES',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
] as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

export interface ChartSeed {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  normalBalance: NormalBalance;
  systemKey: SystemAccountKey | null;
}

export const DEFAULT_CHART: readonly ChartSeed[] = [
  { code: '1000', name: 'Cash on Hand', type: 'ASSET', subtype: 'CASH', normalBalance: 'DEBIT', systemKey: 'CASH_ON_HAND' },
  { code: '1010', name: 'Operating Bank Account', type: 'ASSET', subtype: 'BANK', normalBalance: 'DEBIT', systemKey: 'BANK_OPERATING' },
  { code: '1050', name: 'Stripe Clearing', type: 'ASSET', subtype: 'CLEARING', normalBalance: 'DEBIT', systemKey: 'STRIPE_CLEARING' },
  { code: '1060', name: 'Stripe Disputed Funds', type: 'ASSET', subtype: 'OTHER_CURRENT', normalBalance: 'DEBIT', systemKey: 'STRIPE_DISPUTES' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', subtype: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', systemKey: 'AR' },
  { code: '1150', name: 'Sales Tax Recoverable', type: 'ASSET', subtype: 'TAX_RECOVERABLE', normalBalance: 'DEBIT', systemKey: 'SALES_TAX_RECOVERABLE' },
  { code: '1200', name: 'Inventory', type: 'ASSET', subtype: 'INVENTORY', normalBalance: 'DEBIT', systemKey: 'INVENTORY' },
  { code: '1500', name: 'Equipment', type: 'ASSET', subtype: 'FIXED_ASSET', normalBalance: 'DEBIT', systemKey: 'EQUIPMENT' },
  { code: '1590', name: 'Accumulated Depreciation', type: 'ASSET', subtype: 'CONTRA_ASSET', normalBalance: 'CREDIT', systemKey: null },
  { code: '1900', name: 'Other Assets', type: 'ASSET', subtype: 'OTHER_ASSET', normalBalance: 'DEBIT', systemKey: null },
  { code: '1999', name: 'Suspense', type: 'ASSET', subtype: 'SUSPENSE', normalBalance: 'DEBIT', systemKey: 'SUSPENSE' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subtype: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', systemKey: 'AP' },
  { code: '2100', name: 'Corporate Credit Card', type: 'LIABILITY', subtype: 'CREDIT_CARD', normalBalance: 'CREDIT', systemKey: 'CREDIT_CARD' },
  { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', subtype: 'TAX_PAYABLE', normalBalance: 'CREDIT', systemKey: 'SALES_TAX_PAYABLE' },
  { code: '2300', name: 'Payroll Liabilities', type: 'LIABILITY', subtype: 'PAYROLL', normalBalance: 'CREDIT', systemKey: null },
  { code: '2500', name: 'Loans Payable', type: 'LIABILITY', subtype: 'LOAN', normalBalance: 'CREDIT', systemKey: null },
  { code: '2900', name: 'Other Liabilities', type: 'LIABILITY', subtype: 'OTHER_LIABILITY', normalBalance: 'CREDIT', systemKey: null },
  { code: '3000', name: 'Owner / Shareholder Equity', type: 'EQUITY', subtype: 'OWNER_EQUITY', normalBalance: 'CREDIT', systemKey: 'OWNER_EQUITY' },
  { code: '3900', name: 'Retained Earnings', type: 'EQUITY', subtype: 'RETAINED_EARNINGS', normalBalance: 'CREDIT', systemKey: 'RETAINED_EARNINGS' },
  { code: '3950', name: 'Opening Balance Equity', type: 'EQUITY', subtype: 'OPENING_BALANCE', normalBalance: 'CREDIT', systemKey: 'OPENING_BALANCE_EQUITY' },
  { code: '4000', name: 'Sales Revenue', type: 'REVENUE', subtype: 'SALES', normalBalance: 'CREDIT', systemKey: 'REVENUE_SALES' },
  { code: '4900', name: 'Sales Refunds & Allowances', type: 'REVENUE', subtype: 'CONTRA_REVENUE', normalBalance: 'DEBIT', systemKey: 'SALES_REFUNDS' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'COST_OF_GOODS_SOLD', subtype: 'COGS', normalBalance: 'DEBIT', systemKey: 'COGS' },
  { code: '6000', name: 'Merchant Processing Fees', type: 'EXPENSE', subtype: 'BANK_FEES', normalBalance: 'DEBIT', systemKey: 'MERCHANT_FEES' },
  { code: '6010', name: 'Chargeback & Dispute Losses', type: 'EXPENSE', subtype: 'DISPUTE_LOSS', normalBalance: 'DEBIT', systemKey: 'DISPUTE_LOSSES' },
  { code: '6100', name: 'Uncategorized Expense', type: 'EXPENSE', subtype: 'UNCATEGORIZED', normalBalance: 'DEBIT', systemKey: 'UNCATEGORIZED_EXPENSE' },
  { code: '6200', name: 'Rent', type: 'EXPENSE', subtype: 'OCCUPANCY', normalBalance: 'DEBIT', systemKey: null },
  { code: '6300', name: 'Utilities', type: 'EXPENSE', subtype: 'OCCUPANCY', normalBalance: 'DEBIT', systemKey: null },
  { code: '6400', name: 'Vehicle & Fuel', type: 'EXPENSE', subtype: 'VEHICLE', normalBalance: 'DEBIT', systemKey: null },
  { code: '6500', name: 'Wages & Salaries', type: 'EXPENSE', subtype: 'PAYROLL', normalBalance: 'DEBIT', systemKey: null },
  { code: '6600', name: 'Office & Administrative', type: 'EXPENSE', subtype: 'ADMIN', normalBalance: 'DEBIT', systemKey: null },
  { code: '6700', name: 'Bank Charges', type: 'EXPENSE', subtype: 'BANK_FEES', normalBalance: 'DEBIT', systemKey: 'BANK_CHARGES' },
  { code: '7000', name: 'Other Income', type: 'OTHER_INCOME', subtype: 'OTHER_INCOME', normalBalance: 'CREDIT', systemKey: 'OTHER_INCOME' },
  { code: '8000', name: 'Other Expense', type: 'OTHER_EXPENSE', subtype: 'OTHER_EXPENSE', normalBalance: 'DEBIT', systemKey: 'OTHER_EXPENSE' },
];

/**
 * Signed balance in the account's natural direction: positive means the
 * account carries its normal balance.
 */
export function naturalBalance(normal: NormalBalance, debitMinor: number, creditMinor: number): number {
  return normal === 'DEBIT' ? debitMinor - creditMinor : creditMinor - debitMinor;
}
