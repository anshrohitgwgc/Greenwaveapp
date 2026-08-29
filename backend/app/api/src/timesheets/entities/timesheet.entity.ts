import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'timesheets' })
export class Timesheet {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ name: 'clock_in', type: 'datetime' })
  clockIn: Date;

  @Column({ name: 'clock_out', type: 'datetime', nullable: true })
  clockOut: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
