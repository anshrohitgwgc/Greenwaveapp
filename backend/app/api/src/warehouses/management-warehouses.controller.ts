import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WarehousesService } from './warehouses.service';

@Controller('management/warehouses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ManagementWarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get(':warehouseId/users')
  @Roles('admin', 'manager')
  async getWarehouseUsers(
    @Param('warehouseId') warehouseId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    return this.warehousesService.getWarehouseUsers(warehouseId);
  }
}
