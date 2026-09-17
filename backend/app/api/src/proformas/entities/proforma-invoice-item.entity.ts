import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import type { ProformaInvoice } from './proforma-invoice.entity';

@Entity({ name: 'proforma_invoice_items' })
export class ProformaInvoiceItem {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'proforma_invoice_id', type: 'uuid' })
  proformaInvoiceId: string;

  @Column({ name: 'material_id', type: 'uuid', nullable: true })
  materialId: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  quantity: string;

  @Column({ type: 'varchar', length: 32, default: 'kg' })
  unit: string;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 4 })
  unitPrice: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discount: string;

  @Column({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, default: 0 })
  taxRate: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true })
  weight: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: TIMESTAMP_COLUMN_TYPE })
  createdAt: Date;

  @ManyToOne('ProformaInvoice', (p: ProformaInvoice) => p.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'proforma_invoice_id' })
  proformaInvoice: ProformaInvoice;
}
