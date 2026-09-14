import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

/** Mirror of Stripe balance transactions: what Stripe reports, verbatim amounts. */
@Entity({ name: 'stripe_balance_transactions' })
export class StripeBalanceTransaction {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'provider_txn_id', type: 'varchar', length: 128, unique: true })
  providerTxnId: string;

  @Index()
  @Column({ type: 'varchar', length: 48 })
  type: string;

  @Column({ name: 'reporting_category', type: 'varchar', length: 64, nullable: true })
  reportingCategory: string | null;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ name: 'fee_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  feeMinor: number;

  @Column({ name: 'net_minor', type: 'bigint', transformer: bigintNumberTransformer })
  netMinor: number;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'varchar', length: 16 })
  status: string;

  @Index()
  @Column({ name: 'source_id', type: 'varchar', length: 128, nullable: true })
  sourceId: string | null;

  @Index()
  @Column({ name: 'payout_id', type: 'varchar', length: 128, nullable: true })
  payoutId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Index()
  @Column({ name: 'provider_created', type: TIMESTAMP_COLUMN_TYPE })
  providerCreated: Date;

  @Column({ name: 'available_on', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  availableOn: Date | null;

  @Column({ name: 'synced_at', type: TIMESTAMP_COLUMN_TYPE })
  syncedAt: Date;
}
