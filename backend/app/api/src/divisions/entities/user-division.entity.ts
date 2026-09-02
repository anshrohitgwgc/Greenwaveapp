import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Explicit grant of a business division to a user. Modelled on
 * `user_warehouses` so division access is enforced by exactly the same
 * "membership row or nothing" rule the warehouse isolation already uses.
 *
 * The absence of a row is the absence of access. There is deliberately no
 * role-derived fallback: a brand-new staff member — of any role — starts with
 * zero divisions until an administrator assigns one.
 */
@Entity({ name: 'user_divisions' })
@Unique(['userId', 'division'])
export class UserDivision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  /** Canonical division key — `greenwave` or `healthcare`. */
  @Column({ type: 'varchar', length: 32 })
  division: string;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
