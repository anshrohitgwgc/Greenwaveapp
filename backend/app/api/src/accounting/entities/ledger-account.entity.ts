import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { AccountType, NormalBalance } from '../chart-of-accounts';

@Entity({ name: 'ledger_accounts' })
export class LedgerAccount {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index()
  @Column({ type: 'varchar', length: 24 })
  type: AccountType;

  @Column({ type: 'varchar', length: 40, nullable: true })
  subtype: string | null;

  @Column({ name: 'normal_balance', type: 'varchar', length: 6 })
  normalBalance: NormalBalance;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ name: 'system_key', type: 'varchar', length: 48, nullable: true, unique: true })
  systemKey: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'tax_treatment', type: 'simple-json', nullable: true })
  taxTreatment: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
