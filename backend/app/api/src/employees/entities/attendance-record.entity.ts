import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'REMOTE' | 'HALF_DAY' | 'ON_LEAVE';
export type AttendanceSource = 'MANUAL' | 'TIMESHEET' | 'KIOSK' | 'SYSTEM';

@Entity({ name: 'attendance_records' })
@Index('uq_attendance_employee_date', ['employeeId', 'date'], { unique: true })
export class AttendanceRecord {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'clock_in', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  clockIn: Date | null;

  @Column({ name: 'clock_out', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  clockOut: Date | null;

  @Column({ name: 'total_hours', type: 'numeric', precision: 5, scale: 2, default: 0 })
  totalHours: number;

  @Column({ name: 'overtime_hours', type: 'numeric', precision: 5, scale: 2, default: 0 })
  overtimeHours: number;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'PRESENT' })
  status: AttendanceStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 24, default: 'MANUAL' })
  source: AttendanceSource;

  @Column({ name: 'timesheet_id', type: 'uuid', nullable: true })
  timesheetId: string | null;

  @Column({ name: 'verified_by', type: 'int', nullable: true })
  verifiedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
