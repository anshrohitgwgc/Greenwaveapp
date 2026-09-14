import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { bigintNumberTransformer, TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type BillStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID';

/**
 * A vendor bill. Approval (DRAFT -> OPEN) is what creates the Accounts
 * Payable liability. `purchaseOrderId` only links the originating PO; a PO by
 * itself never posts to the ledger.
 */
@Entity({ name: 'bills' })
@Index('uq_bills_vendor_number', ['vendorId', 'billNumber'], { unique: true })
export class Bill {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId: string;

  @Column({ name: 'bill_number', type: 'varchar', length: 64 })
  billNumber: string;

  @Column({ name: 'bill_date', type: 'date' })
  billDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ name: 'expense_account_id', type: 'uuid' })
  expenseAccountId: string;

  @Column({ name: 'subtotal_minor', type: 'bigint', transformer: bigintNumberTransformer })
  subtotalMinor: number;

  @Column({ name: 'tax_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  taxMinor: number;

  @Column({ name: 'total_minor', type: 'bigint', transformer: bigintNumberTransformer })
  totalMinor: number;

  @Column({ name: 'paid_minor', type: 'bigint', default: 0, transformer: bigintNumberTransformer })
  paidMinor: number;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status: BillStatus;

  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId: string | null;

  @Column({ type: 'text', nullable: true })
  memo: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @Column({ name: 'approved_by', type: 'int', nullable: true })
  approvedBy: number | null;

  @Column({ name: 'approved_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
