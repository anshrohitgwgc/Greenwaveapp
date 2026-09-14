import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn } from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';
import { JournalLine } from './journal-line.entity';

export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'REVERSED';

@Entity({ name: 'journal_entries' })
@Index('uq_journal_entries_source', ['sourceType', 'sourceId', 'sourceEvent'], {
  unique: true,
  where: 'source_id IS NOT NULL AND source_event IS NOT NULL',
})
export class JournalEntry {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'entry_date', type: 'date' })
  entryDate: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'POSTED' })
  status: JournalEntryStatus;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  /** 'invoice' | 'payment' | 'refund' | 'stripe_payout' | 'dispute' | 'manual' | ... */
  @Column({ name: 'source_type', type: 'varchar', length: 48 })
  sourceType: string;

  @Column({ name: 'source_id', type: 'varchar', length: 100, nullable: true })
  sourceId: string | null;

  @Column({ name: 'source_event', type: 'varchar', length: 96, nullable: true })
  sourceEvent: string | null;

  @Column({ name: 'reversal_of', type: 'uuid', nullable: true })
  reversalOf: string | null;

  @Column({ name: 'reversed_by', type: 'uuid', nullable: true })
  reversedBy: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @Column({ name: 'posted_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  postedAt: Date | null;

  @Column({ name: 'request_id', type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => JournalLine, (line) => line.entry)
  lines?: JournalLine[];
}
