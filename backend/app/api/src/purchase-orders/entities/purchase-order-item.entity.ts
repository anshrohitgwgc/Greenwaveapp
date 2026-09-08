import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { PurchaseOrder } from './purchase-order.entity';

@Entity({ name: 'purchase_order_items' })
export class PurchaseOrderItem {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'purchase_order_id', type: 'uuid' })
  purchaseOrderId: string;

  // An explicit @JoinColumn is required here. Without it TypeORM invents its
  // own camelCase join column that does not exist in PostgreSQL, and every
  // query loading this relation 500s — the exact bug documented on
  // InvoiceItem.invoice. The sqlite-backed specs would not catch it, because
  // synchronize:true silently creates both columns.
  @ManyToOne(() => PurchaseOrder, (po) => po.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder: PurchaseOrder;

  @Column({ type: 'varchar', length: 64, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  resin: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  color: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 3 })
  quantity: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  unit: string | null;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 4 })
  unitPrice: string;

  /** quantity x unitPrice, computed server-side. Never trusted from a client. */
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
