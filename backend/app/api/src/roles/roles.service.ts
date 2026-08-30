import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';

const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'invoices:manage',
    'customers:manage',
    'materials:manage',
    'inventory:write',
    'inventory:adjust',
    'photos:read_all',
    'photos:delete',
    'staff:manage',
    'audit:read',
    'warehouses:manage',
    'warehouses:read_all',
    'warehouses:assign',
    'warehouses:global_access',
    'chat:read',
    'chat:write',
  ],
  manager: [
    'invoices:manage',
    'customers:manage',
    'materials:manage',
    'inventory:write',
    'inventory:adjust',
    'photos:read_all',
    'audit:read',
    'warehouses:manage',
    'chat:read',
    'chat:write',
  ],
  staff: ['inventory:write', 'chat:read', 'chat:write'],
  driver: ['inventory:write', 'chat:read', 'chat:write'],
};

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
  ) {}

  async listRoles() {
    const roles = await this.roleRepository.find();
    const links = await this.rolePermissionRepository.find();
    const permissions = await this.permissionRepository.find();
    const permissionById = new Map(permissions.map((p) => [p.id, p.key]));

    return roles.map((role) => ({
      ...role,
      permissions: links
        .filter((link) => link.roleId === role.id)
        .map((link) => permissionById.get(link.permissionId))
        .filter(Boolean),
    }));
  }

  listPermissions() {
    return this.permissionRepository.find();
  }

  async getPermissionsForRole(roleName: string): Promise<string[]> {
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });
    if (!role) {
      return ROLE_DEFAULT_PERMISSIONS[roleName] ?? [];
    }

    const links = await this.rolePermissionRepository.find({
      where: { roleId: role.id },
    });

    if (links.length === 0) {
      return ROLE_DEFAULT_PERMISSIONS[roleName] ?? [];
    }

    const permissions = await this.permissionRepository.find();
    const permissionById = new Map(permissions.map((p) => [p.id, p.key]));

    const mapped = links
      .map((link) => permissionById.get(link.permissionId))
      .filter((k): k is string => Boolean(k));

    return mapped.length > 0
      ? mapped
      : (ROLE_DEFAULT_PERMISSIONS[roleName] ?? []);
  }
}
