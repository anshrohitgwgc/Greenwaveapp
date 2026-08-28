import { Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'role_permissions' })
export class RolePermission {
  @PrimaryColumn('uuid', { name: 'role_id' })
  roleId: string;

  @PrimaryColumn('uuid', { name: 'permission_id' })
  permissionId: string;
}
