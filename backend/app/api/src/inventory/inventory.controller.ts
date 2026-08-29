import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateContainerDto } from './dto/create-container.dto';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { InventoryService } from './inventory.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('containers')
  @Roles('admin', 'manager', 'staff', 'driver')
  createContainer(
    @Body() dto: CreateContainerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.createContainer(dto, actor.id);
  }

  @Get('containers')
  @Roles('admin', 'manager', 'staff', 'driver')
  listContainers(
    @Query('warehouseId') warehouseId?: string,
    @Query('search') search?: string,
  ) {
    return this.inventoryService.listContainers(warehouseId, search);
  }

  @Post('inventory/transactions')
  @Roles('admin', 'manager', 'staff', 'driver')
  createTransaction(
    @Body() dto: CreateInventoryTransactionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.inventoryService.createTransaction(dto, actor);
  }

  @Get('inventory/transactions')
  @Roles('admin', 'manager', 'staff', 'driver')
  listTransactions(
    @Query('warehouseId') warehouseId?: string,
    @Query('materialId') materialId?: string,
    @Query('type') type?: string,
    @Query('orderNumber') orderNumber?: string,
    @Query('containerNumber') containerNumber?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.inventoryService.listTransactions({
      warehouseId,
      materialId,
      type,
      orderNumber,
      containerNumber,
      search,
      startDate,
      endDate,
    });
  }

  @Get('inventory/balances')
  @Roles('admin', 'manager', 'staff', 'driver')
  getBalances(@Query('warehouseId') warehouseId?: string) {
    return this.inventoryService.getBalances(warehouseId);
  }
}
