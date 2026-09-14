import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

@Entity({ name: 'stripe_disputes' })
export class StripeDispute {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'provider_dispute_id', type: 'varchar', length: 128, unique: true })
  providerDisputeId: string;

  @Index()
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @Column({ name: 'provider_charge_id', type: 'varchar', length: 128, nullable: true })
  providerChargeId: string | null;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'varchar', length: 40 })
  status: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reason: string | null;

  @Column({ name: 'evidence_due_by', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  evidenceDueBy: Date | null;

  @Column({ name: 'provider_created', type: TIMESTAMP_COLUMN_TYPE })
  providerCreated: Date;

  @Column({ name: 'last_event_created', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  lastEventCreated: number | null;

  @Column({ name: 'synced_at', type: TIMESTAMP_COLUMN_TYPE })
  syncedAt: Date;
}
