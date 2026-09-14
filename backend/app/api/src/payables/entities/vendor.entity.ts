import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'vendors' })
export class Vendor {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  phone: string | null;

  @Column({ name: 'default_expense_account_id', type: 'uuid', nullable: true })
  defaultExpenseAccountId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
