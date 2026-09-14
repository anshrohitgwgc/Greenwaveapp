import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type EmailOutboxStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/**
 * One row per logical email. `dedupeKey` is unique, so a duplicate webhook
 * delivery that tries to send the same confirmation twice collides here.
 * Bodies are not stored.
 */
@Entity({ name: 'email_outbox' })
export class EmailOutbox {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 160, unique: true })
  dedupeKey: string;

  @Column({ type: 'varchar', length: 64 })
  template: string;

  @Column({ type: 'varchar', length: 255 })
  recipient: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status: EmailOutboxStatus;

  @Column({ name: 'entity_type', type: 'varchar', length: 64, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  entityId: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 255, nullable: true })
  providerMessageId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  sentAt: Date | null;
}
