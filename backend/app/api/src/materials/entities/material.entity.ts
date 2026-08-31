import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'materials' })
export class Material {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 32, default: 'kg' })
  unit: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'default_price',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  defaultPrice: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 32, default: 'recycling' })
  division: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
