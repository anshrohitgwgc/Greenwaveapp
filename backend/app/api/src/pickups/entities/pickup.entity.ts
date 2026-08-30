import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'pickup' })
export class Pickup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'userId', type: 'int', default: 1 })
  userId: number;

  @Column({ name: 'address', type: 'text' })
  address: string;

  @Column({
    name: 'wasteType',
    type: 'varchar',
    length: 100,
    default: 'electronics',
  })
  wasteType: string;

  @Column({ name: 'estimatedWeightKg', type: 'numeric', nullable: true })
  estimatedWeightKg: number | null;

  @Column({ name: 'actualWeightKg', type: 'numeric', nullable: true })
  actualWeightKg: number | null;

  @Column({ name: 'priceTotal', type: 'numeric', nullable: true })
  priceTotal: number | null;

  @Column({ name: 'assignedDriverId', type: 'int', nullable: true })
  assignedDriverId: number | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'status', type: 'varchar', default: 'pending' })
  status: string;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt: Date;
}
