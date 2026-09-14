import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';
import type { LeaveType } from './leave-balance.entity';

export type LeaveRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

@Entity({ name: 'leave_requests' })
export class LeaveRequest {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'leave_type', type: 'varchar', length: 24 })
  leaveType: LeaveType;

  @Index()
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Index()
  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'days_count', type: 'numeric', precision: 5, scale: 2 })
  daysCount: number;

  @Column({ type: 'text' })
  reason: string;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'SUBMITTED' })
  status: LeaveRequestStatus;

  @Column({ name: 'submitted_at', type: TIMESTAMP_COLUMN_TYPE })
  submittedAt: Date;

  @Column({ name: 'reviewed_by', type: 'int', nullable: true })
  reviewedBy: number | null;

  @Column({ name: 'reviewed_at', type: TIMESTAMP_COLUMN_TYPE, nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_comments', type: 'text', nullable: true })
  reviewComments: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
