import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'containers' })
export class Container {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({
    name: 'order_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  orderNumber: string | null;

  @Column({ name: 'bl_number', type: 'varchar', length: 100, nullable: true })
  blNumber: string | null;

  @Column({
    name: 'shipping_line',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  shippingLine: string | null;

  @Index()
  @Column({
    name: 'container_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  containerNumber: string | null;

  @Index()
  @Column({ name: 'seal_number', type: 'varchar', length: 100, nullable: true })
  sealNumber: string | null;

  @Column({
    name: 'product_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  productName: string | null;

  @Column({ name: 'material_id', type: 'uuid', nullable: true })
  materialId: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  xl: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  l: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  m: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  s: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  total: string;

  @Column({ type: 'date', nullable: true })
  eta: string | null;

  @Column({ type: 'varchar', length: 32, default: 'in_transit' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
