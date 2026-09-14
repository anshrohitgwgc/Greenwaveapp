import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type StripeSyncKind = 'INITIAL' | 'INCREMENTAL' | 'MANUAL';
export type StripeSyncStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED';

@Entity({ name: 'stripe_sync_runs' })
export class StripeSyncRun {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: StripeSyncKind;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  status: StripeSyncStatus;

  @Index()
  @Column({ name: 'started_at', type: TIMESTAMP_COLUMN_TYPE })
  startedAt: Date;

  @Column({ name: 'finished_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'from_created', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  fromCreated: number | null;

  @Column({ name: 'to_created', type: 'bigint', nullable: true, transformer: bigintNumberTransformer })
  toCreated: number | null;

  @Column({ type: 'simple-json', nullable: true })
  counts: Record<string, number> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'triggered_by', type: 'int', nullable: true })
  triggeredBy: number | null;
}
