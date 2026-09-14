import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type LeaveType = 'VACATION' | 'SICK' | 'PERSONAL' | 'OTHER';

@Entity({ name: 'leave_balances' })
@Index('uq_leave_balances_emp_year_type', ['employeeId', 'year', 'leaveType'], { unique: true })
export class LeaveBalance {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ type: 'smallint' })
  year: number;

  @Column({ name: 'leave_type', type: 'varchar', length: 24 })
  leaveType: LeaveType;

  @Column({ name: 'entitlement_days', type: 'numeric', precision: 5, scale: 2, default: 0 })
  entitlementDays: number;

  @Column({ name: 'used_days', type: 'numeric', precision: 5, scale: 2, default: 0 })
  usedDays: number;

  @Column({ name: 'pending_days', type: 'numeric', precision: 5, scale: 2, default: 0 })
  pendingDays: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
