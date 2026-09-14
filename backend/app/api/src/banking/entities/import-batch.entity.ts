import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type ImportBatchStatus = 'PREVIEWED' | 'COMMITTED' | 'DISCARDED';

/** Audit record of one statement import: which file, which mapping, what happened. */
@Entity({ name: 'import_batches' })
export class ImportBatch {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'file_sha256', type: 'varchar', length: 64 })
  fileSha256: string;

  @Column({ type: 'varchar', length: 16 })
  status: ImportBatchStatus;

  @Column({ type: 'simple-json' })
  mapping: Record<string, unknown>;

  @Column({ name: 'row_count', type: 'int', default: 0 })
  rowCount: number;

  @Column({ name: 'valid_count', type: 'int', default: 0 })
  validCount: number;

  @Column({ name: 'duplicate_count', type: 'int', default: 0 })
  duplicateCount: number;

  @Column({ name: 'error_count', type: 'int', default: 0 })
  errorCount: number;

  @Column({ name: 'imported_count', type: 'int', default: 0 })
  importedCount: number;

  @Column({ type: 'simple-json', nullable: true })
  errors: Array<{ rowNo: number; message: string }> | null;

  @Column({ name: 'date_min', type: 'date', nullable: true })
  dateMin: string | null;

  @Column({ name: 'date_max', type: 'date', nullable: true })
  dateMax: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @Column({ name: 'committed_by', type: 'int', nullable: true })
  committedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'committed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  committedAt: Date | null;
}
