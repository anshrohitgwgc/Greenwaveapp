import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { InvoiceItem } from './invoice-item.entity';

@Entity({ name: 'invoices' })
export class Invoice {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'invoice_number', type: 'varchar', length: 32, unique: true })
  invoiceNumber: string;

  @Column({ name: 'invoice_date', type: 'date' })
  invoiceDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'company_info', type: 'simple-json', nullable: true })
  companyInfo: Record<string, unknown> | null;

  @Column({ name: 'bill_to', type: 'text', nullable: true })
  billTo: string | null;

  @Column({ name: 'ship_to', type: 'text', nullable: true })
  shipTo: string | null;

  @Column({
    name: 'po_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  poReference: string | null;

  @Column({
    name: 'payment_terms',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  paymentTerms: string | null;

  @Column({ name: 'ship_via', type: 'varchar', length: 150, nullable: true })
  shipVia: string | null;

  @Column({ name: 'ship_date', type: 'date', nullable: true })
  shipDate: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal: string;

  @Column({
    name: 'discount_total',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  discountTotal: string;

  @Column({ name: 'tax_label', type: 'varchar', length: 32, nullable: true })
  taxLabel: string | null;

  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 6,
    scale: 3,
    default: 0,
  })
  taxRate: string;

  @Column({
    name: 'tax_total',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  taxTotal: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  terms: string | null;

  @Column({ type: 'text', nullable: true })
  footer: string | null;

  @Column({ name: 'payment_instructions', type: 'text', nullable: true })
  paymentInstructions: string | null;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 32,
    default: 'unpaid',
  })
  paymentStatus: string;

  @Column({
    name: 'payment_token',
    type: 'varchar',
    length: 64,
    nullable: true,
    unique: true,
  })
  paymentToken: string | null;

  @Column({ type: 'varchar', length: 8, default: 'CAD' })
  currency: string;

  @Column({
    name: 'paid_at',
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  paidAt: Date | null;

  @Column({
    name: 'payment_provider',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  paymentProvider: string | null;

  @Column({
    name: 'payment_reference',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  paymentReference: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  /**
   * Business division this invoice belongs to. Storage value — `recycling`
   * or `healthcare` — see src/divisions/divisions.constants.ts. Scoping only;
   * it has no bearing on invoice numbering, which stays a single global
   * PostgreSQL sequence (migration 016).
   */
  @Column({ type: 'varchar', length: 32, default: 'recycling' })
  division: string;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => InvoiceItem, (item) => item.invoice, { cascade: true })
  items: InvoiceItem[];
}
