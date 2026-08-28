import { Column, Entity, ManyToOne, PrimaryColumn } from 'typeorm';

import { Invoice } from './invoice.entity';

@Entity({ name: 'invoice_items' })
export class InvoiceItem {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  invoice: Invoice;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  quantity: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  unit: string | null;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 4 })
  unitPrice: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discount: string;

  @Column({ name: 'is_rebate', type: 'boolean', default: false })
  isRebate: boolean;

  @Column({ name: 'line_total', type: 'numeric', precision: 12, scale: 2 })
  lineTotal: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
