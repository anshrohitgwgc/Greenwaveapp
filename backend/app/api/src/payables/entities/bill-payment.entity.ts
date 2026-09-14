import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

@Entity({ name: 'bill_payments' })
export class BillPayment {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'bill_id', type: 'uuid' })
  billId: string;

  @Index()
  @Column({ name: 'financial_transaction_id', type: 'uuid' })
  financialTransactionId: string;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ name: 'paid_date', type: 'date' })
  paidDate: string;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  @Column({ name: 'reversed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
