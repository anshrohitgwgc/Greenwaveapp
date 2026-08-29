import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Invoice } from './invoice.entity';

@Entity({ name: 'invoice_items' })
export class InvoiceItem {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  // Without an explicit @JoinColumn, TypeORM invents its own join column
  // (named `invoiceId`, camelCase) instead of reusing the `invoice_id`
  // column declared above — that phantom column doesn't exist in Postgres,
  // so any query that loads this relation (e.g. GET /invoices) 500s. This
  // only worked in the unit-test suite because it runs against sqlite with
  // synchronize:true, which silently creates both columns.
  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
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
