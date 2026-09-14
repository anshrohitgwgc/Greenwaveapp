import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type EmployeeStatus = 'ACTIVE' | 'PROBATION' | 'SUSPENDED' | 'TERMINATED' | 'ON_LEAVE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'SEASONAL';

@Entity({ name: 'employees' })
export class Employee {
  @PrimaryColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'employee_id', type: 'varchar', length: 32 })
  employeeId: string;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId: number | null;

  @Column({ name: 'first_name', type: 'varchar', length: 64 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 64 })
  lastName: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  department: string;

  @Column({ type: 'varchar', length: 64 })
  position: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'ACTIVE' })
  status: EmployeeStatus;

  @Column({ name: 'employment_type', type: 'varchar', length: 24, default: 'FULL_TIME' })
  employmentType: EmploymentType;

  @Index()
  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string | null;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
