import { Controller, Get, UseGuards } from '@nestjs/common';

import { Roles as RequireRoles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RolesService } from './roles.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('admin')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('roles')
  listRoles() {
    return this.rolesService.listRoles();
  }

  @Get('permissions')
  listPermissions() {
    return this.rolesService.listPermissions();
  }
}
