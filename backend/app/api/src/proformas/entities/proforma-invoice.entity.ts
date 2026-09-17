import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';
import { ProformaInvoiceItem } from './proforma-invoice-item.entity';

export type ProformaStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'expired'
  | 'converted'
  | 'cancelled';

@Entity({ name: 'proforma_invoices' })
export class ProformaInvoice {
  @PrimaryColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'proforma_number', type: 'varchar', length: 32 })
  proformaNumber: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255, nullable: true })
  customerName: string | null;

  @Column({ type: 'varchar', length: 32, default: 'recycling' })
  division: string;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate: string;

  @Column({ name: 'validity_date', type: 'date', nullable: true })
  validityDate: string | null;

  @Column({ type: 'varchar', length: 8, default: 'CAD' })
  currency: string;

  @Column({ name: 'po_reference', type: 'varchar', length: 100, nullable: true })
  poReference: string | null;

  @Column({ name: 'bill_to', type: 'text', nullable: true })
  billTo: string | null;

  @Column({ name: 'ship_to', type: 'text', nullable: true })
  shipTo: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  origin: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  destination: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  incoterm: string | null;

  @Column({ name: 'incoterm_location', type: 'varchar', length: 150, nullable: true })
  incotermLocation: string | null;

  @Column({ name: 'shipping_terms', type: 'varchar', length: 150, nullable: true })
  shippingTerms: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal: string;

  @Column({ name: 'tax_total', type: 'numeric', precision: 12, scale: 2, default: 0 })
  taxTotal: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total: string;

  @Column({ name: 'total_weight', type: 'numeric', precision: 12, scale: 3, nullable: true })
  totalWeight: string | null;

  @Column({ name: 'weight_unit', type: 'varchar', length: 16, default: 'kg' })
  weightUnit: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'commercial_terms', type: 'text', nullable: true })
  commercialTerms: string | null;

  @Column({ name: 'internal_notes', type: 'text', nullable: true })
  internalNotes: string | null;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status: ProformaStatus;

  @Index()
  @Column({ name: 'converted_invoice_id', type: 'uuid', nullable: true })
  convertedInvoiceId: string | null;

  @Column({ name: 'converted_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  convertedAt: Date | null;

  @Column({ name: 'converted_by', type: 'int', nullable: true })
  convertedBy: number | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at', type: TIMESTAMP_COLUMN_TYPE })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: TIMESTAMP_COLUMN_TYPE })
  updatedAt: Date;

  @OneToMany(() => ProformaInvoiceItem, (item) => item.proformaInvoice, {
    cascade: true,
  })
  items: ProformaInvoiceItem[];
}
