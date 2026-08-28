import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';

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
}
