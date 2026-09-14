import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type FinancialAccountKind = 'BANK' | 'CREDIT_CARD';

/**
 * A bank or corporate credit-card account whose statements are imported.
 * Holds a 4-digit mask only, never a full account or card number.
 */
@Entity({ name: 'financial_accounts' })
export class FinancialAccount {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: FinancialAccountKind;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  institution: string | null;

  @Column({ name: 'account_mask', type: 'varchar', length: 4, nullable: true })
  accountMask: string | null;

  @Column({ name: 'account_type', type: 'varchar', length: 24 })
  accountType: string;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Index({ unique: true })
  @Column({ name: 'ledger_account_id', type: 'uuid' })
  ledgerAccountId: string;

  @Column({ name: 'credit_limit_minor', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  creditLimitMinor: number | null;

  @Column({ name: 'statement_day', type: 'int', nullable: true })
  statementDay: number | null;

  @Column({ name: 'payment_due_day', type: 'int', nullable: true })
  paymentDueDay: number | null;

  @Column({ name: 'connection_type', type: 'varchar', length: 16, default: 'MANUAL_CSV' })
  connectionType: string;

  @Column({ name: 'connection_status', type: 'varchar', length: 16, default: 'NOT_CONNECTED' })
  connectionStatus: string;

  @Column({ type: 'varchar', length: 48, nullable: true })
  provider: string | null;

  @Column({ name: 'provider_account_ref', type: 'varchar', length: 128, nullable: true })
  providerAccountRef: string | null;

  @Column({ name: 'last_synced_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_imported_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  lastImportedAt: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
