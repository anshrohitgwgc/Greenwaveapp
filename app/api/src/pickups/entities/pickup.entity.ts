import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class Pickup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  customerName: string;

  @Column()
  address: string;

  @Column()
  materialType: string;

  @Column({
    type: 'float',
    nullable: true,
  })
  estimatedWeight: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  notes: string;

  @Column({
    default: 'pending',
  })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
