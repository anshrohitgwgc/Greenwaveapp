import { Entity, PrimaryColumn } from 'typeorm';

/**
 * Kept in sync 1:1 with `user.role` (the fast-path column every guard
 * actually checks) rather than being the live enforcement path itself —
 * see docs/V2_ARCHITECTURE.md §4. This exists so the richer roles/
 * permissions schema the brief asked for is real and queryable, without
 * a breaking rewrite of the existing auth code.
 */
@Entity({ name: 'user_roles' })
export class UserRole {
  @PrimaryColumn('int', { name: 'user_id' })
  userId: number;

  @PrimaryColumn('uuid', { name: 'role_id' })
  roleId: string;
}
