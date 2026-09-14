import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type TransactionStatus = 'UNREVIEWED' | 'CATEGORIZED' | 'MATCHED' | 'RECONCILED' | 'EXCLUDED';
export type TransactionDirection = 'DEBIT' | 'CREDIT';
export type MatchType = 'PAYOUT' | 'BILL' | 'TRANSFER' | 'JOURNAL_ENTRY';

/**
 * A line from an external statement. It is evidence, not accounting: it
 * reaches the ledger only through categorize (posts a new entry) or match
 * (links to, or posts the entry for, a known business event).
 *
 * Direction is from the statement's perspective. BANK: CREDIT = money in.
 * CREDIT_CARD: DEBIT = a charge (balance owed increases).
 */
@Entity({ name: 'financial_transactions' })
@Index('uq_financial_transactions_dedupe', ['accountId', 'dedupeHash'], { unique: true })
@Index('uq_financial_transactions_external', ['accountId', 'externalId'], { unique: true, where: 'external_id IS NOT NULL' })
export class FinancialTransaction {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Index()
  @Column({ name: 'transaction_date', type: 'date' })
  transactionDate: string;

  @Column({ name: 'posted_date', type: 'date', nullable: true })
  postedDate: string | null;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  merchant: string | null;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 6 })
  direction: TransactionDirection;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ name: 'external_id', type: 'varchar', length: 128, nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 16 })
  source: 'CSV_IMPORT' | 'MANUAL' | 'PROVIDER';

  @Column({ name: 'import_batch_id', type: 'uuid', nullable: true })
  importBatchId: string | null;

  @Column({ name: 'dedupe_hash', type: 'varchar', length: 64 })
  dedupeHash: string;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'UNREVIEWED' })
  status: TransactionStatus;

  @Column({ name: 'category_account_id', type: 'uuid', nullable: true })
  categoryAccountId: string | null;

  @Column({ name: 'match_type', type: 'varchar', length: 16, nullable: true })
  matchType: MatchType | null;

  @Column({ name: 'match_ref', type: 'varchar', length: 128, nullable: true })
  matchRef: string | null;

  @Index()
  @Column({ name: 'matched_journal_entry_id', type: 'uuid', nullable: true })
  matchedJournalEntryId: string | null;

  @Column({ name: 'posted_journal_entry_id', type: 'uuid', nullable: true })
  postedJournalEntryId: string | null;

  @Column({ name: 'reconciliation_id', type: 'uuid', nullable: true })
  reconciliationId: string | null;

  @Column({ name: 'receipt_ref', type: 'varchar', length: 255, nullable: true })
  receiptRef: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'reviewed_by', type: 'int', nullable: true })
  reviewedBy: number | null;

  @Column({ name: 'reviewed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
