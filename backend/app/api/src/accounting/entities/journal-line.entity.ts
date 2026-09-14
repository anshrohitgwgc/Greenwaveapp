import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { bigintNumberTransformer } from '../../common/db-types';
import { JournalEntry } from './journal-entry.entity';

@Entity({ name: 'journal_lines' })
@Index('uq_journal_lines_entry_line', ['entryId', 'lineNo'], { unique: true })
export class JournalLine {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'entry_id', type: 'uuid' })
  entryId: string;

  @ManyToOne(() => JournalEntry, (e) => e.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry?: JournalEntry;

  @Column({ name: 'line_no', type: 'int' })
  lineNo: number;

  @Index()
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'debit_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  debitMinor: number;

  @Column({ name: 'credit_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  creditMinor: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'vendor_id', type: 'uuid', nullable: true })
  vendorId: string | null;
}
