import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type InventoryTransactionType = 'inbound' | 'outbound' | 'adjustment';

@Entity({ name: 'inventory_transactions' })
export class InventoryTransaction {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Index()
  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ name: 'container_id', type: 'uuid', nullable: true })
  containerId: string | null;

  @Column({ type: 'varchar', length: 16 })
  type: InventoryTransactionType;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  xl: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  l: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  m: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  s: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  total: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  reference: string | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
