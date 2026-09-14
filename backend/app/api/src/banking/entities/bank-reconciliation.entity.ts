import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

@Entity({ name: 'bank_reconciliations' })
@Index('uq_bank_reconciliations_one_open', ['accountId'], { unique: true, where: `status = 'IN_PROGRESS'` })
export class BankReconciliation {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'statement_end_date', type: 'date' })
  statementEndDate: string;

  @Column({ name: 'opening_balance_minor', type: 'bigint', transformer: bigintNumberTransformer })
  openingBalanceMinor: number;

  @Column({ name: 'statement_ending_balance_minor', type: 'bigint', transformer: bigintNumberTransformer })
  statementEndingBalanceMinor: number;

  @Column({ name: 'cleared_balance_minor', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  clearedBalanceMinor: number | null;

  @Column({ name: 'difference_minor', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  differenceMinor: number | null;

  @Column({ type: 'varchar', length: 16 })
  status: 'IN_PROGRESS' | 'COMPLETED';

  @Column({ name: 'started_by', type: 'int', nullable: true })
  startedBy: number | null;

  @Column({ name: 'completed_by', type: 'int', nullable: true })
  completedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  completedAt: Date | null;
}
