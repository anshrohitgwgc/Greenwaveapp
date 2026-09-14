import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import type { ParsedStatementRow } from '../statement-import';

/** Staged, already-masked row from a previewed import. The raw CSV is never stored. */
@Entity({ name: 'import_batch_rows' })
@Index('uq_import_batch_rows', ['batchId', 'rowNo'], { unique: true })
export class ImportBatchRow {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'row_no', type: 'int' })
  rowNo: number;

  @Column({ type: 'varchar', length: 16 })
  status: 'VALID' | 'DUPLICATE' | 'ERROR';

  @Column({ type: 'simple-json', nullable: true })
  parsed: ParsedStatementRow | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
