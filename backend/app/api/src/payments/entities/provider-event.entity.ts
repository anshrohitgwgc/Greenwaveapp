import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type ProviderEventStatus = 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';

/**
 * Idempotency ledger for provider webhooks: one row per Stripe event id.
 * Stores a bounded summary only — never the raw payload.
 */
@Entity({ name: 'provider_events' })
@Index('uq_provider_events', ['provider', 'providerEventId'], { unique: true })
export class ProviderEvent {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, default: 'stripe' })
  provider: string;

  @Column({ name: 'provider_event_id', type: 'varchar', length: 128 })
  providerEventId: string;

  @Index()
  @Column({ name: 'event_type', type: 'varchar', length: 96 })
  eventType: string;

  @Index()
  @Column({ name: 'object_id', type: 'varchar', length: 128, nullable: true })
  objectId: string | null;

  @Column({ type: 'boolean', default: false })
  livemode: boolean;

  @Column({ name: 'provider_created', type: 'bigint', transformer: bigintNumberTransformer })
  providerCreated: number;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'RECEIVED' })
  status: ProviderEventStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'simple-json', nullable: true })
  summary: Record<string, unknown> | null;

  @Column({ name: 'received_at', type: TIMESTAMP_COLUMN_TYPE })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  processedAt: Date | null;
}
