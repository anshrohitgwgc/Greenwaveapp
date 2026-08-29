import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
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

  @CreateDateColumn({ name: 'clock_in' })
  clockIn: Date;

  @Column({ name: 'clock_out', type: 'timestamp with time zone', nullable: true })
  clockOut: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
