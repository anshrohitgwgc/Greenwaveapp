import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

@Entity({ name: 'stripe_payouts' })
export class StripePayout {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'provider_payout_id', type: 'varchar', length: 128, unique: true })
  providerPayoutId: string;

  @Column({ name: 'amount_minor', type: 'bigint', transformer: bigintNumberTransformer })
  amountMinor: number;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Index()
  @Column({ type: 'varchar', length: 24 })
  status: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  method: string | null;

  @Index()
  @Column({ name: 'arrival_date', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  arrivalDate: Date | null;

  @Column({ name: 'provider_created', type: TIMESTAMP_COLUMN_TYPE })
  providerCreated: Date;

  @Column({ name: 'destination_display', type: 'varchar', length: 64, nullable: true })
  destinationDisplay: string | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode: string | null;

  @Column({ name: 'last_event_created', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  lastEventCreated: number | null;

  @Column({ name: 'synced_at', type: TIMESTAMP_COLUMN_TYPE })
  syncedAt: Date;
}
