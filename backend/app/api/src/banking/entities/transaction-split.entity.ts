import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer } from '../../common/db-types';

@Entity({ name: 'transaction_splits' })
@Index('uq_transaction_splits', ['transactionId', 'lineNo'], { unique: true })
export class TransactionSplit {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo: number;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;
}
